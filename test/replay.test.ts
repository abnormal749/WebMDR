/// <reference types="vite/client" />
// Replays the H-003 capture (docs/device-matrix.md): the captured RX frames
// are fed back in the captured order, the user actions are repeated at the
// captured points, and the controller must reproduce the captured log exactly,
// including every TX byte, sequence number and ACK.
//
// Provenance: captured on a WH-1000XM5 by the user, 2026-09-25, via the
// in-page diagnostics log. The log records decoded frames, not raw wire bytes.

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Controller } from '../src/app/controller';
import type { NoiseEdit } from '../src/features/noiseControl';
import { encodeFrame } from '../src/protocol/codec';
import { XM5 } from '../src/protocol/profiles';
import capture from './captures/h003.log?raw';
import { FakeChannel } from './fakeChannel';
import { hex } from './fixtures';

type Action = 'attach' | 'refresh' | 'disconnect' | NoiseEdit;

/** User actions, keyed by the timestamp of the first log line each one caused. */
const actions: Record<string, Action> = {
  '02:25:01.472': 'attach',
  '02:25:05.935': 'refresh',
  '02:25:06.892': 'disconnect',
  '02:25:10.690': 'attach',
  '02:25:14.710': 'disconnect',
  '02:25:21.153': 'attach',
  '02:25:26.444': { mode: 'off' },
  '02:25:29.289': { mode: 'noise-cancelling' },
  '02:25:30.685': { mode: 'ambient' },
  '02:25:32.100': { level: 3 },
  '02:25:36.832': { level: 17 },
  '02:25:40.284': { voice: true },
  '02:25:41.385': { voice: false },
  '02:25:44.219': { level: 12 },
};

const RX = /^RX type (\d+) seq (\d+) \[([0-9a-f ]*)\]$/;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('reproduces the H-003 hardware capture exactly', async () => {
  const entries = capture
    .trim()
    .split('\n')
    .map((line) => ({ stamp: line.slice(0, 12), text: line.slice(line.indexOf(' ') + 1) }));
  // Lines before the first TX belong to a session that is not in the capture.
  const replayed = entries.slice(entries.findIndex((e) => e.text.startsWith('TX ')));

  const produced: string[] = [];
  const controller = new Controller(XM5, { onLog: (line) => produced.push(line) });
  let channel = new FakeChannel();
  let rxGroup: Uint8Array[] = [];
  const flush = () => vi.advanceTimersByTimeAsync(0);

  const deliverRx = async () => {
    if (rxGroup.length === 0) return;
    channel.deliver(Uint8Array.from(rxGroup.flatMap((b) => [...b])));
    rxGroup = [];
    await flush();
  };

  for (const { stamp, text } of replayed) {
    const action = actions[stamp];
    if (action !== undefined) {
      await deliverRx();
      if (action === 'attach') {
        channel = new FakeChannel();
        void controller.attach(channel, 'control');
      } else if (action === 'refresh') void controller.refresh();
      else if (action === 'disconnect') void controller.disconnect();
      else controller.commit(action);
    }
    const rx = RX.exec(text);
    if (rx) {
      rxGroup.push(encodeFrame({ type: Number(rx[1]), seq: Number(rx[2]), payload: hex(rx[3] || '00').subarray(0, rx[3] ? undefined : 0) }));
    } else {
      await deliverRx();
      await flush();
    }
  }
  await deliverRx();

  expect(produced).toEqual(replayed.map((e) => e.text));
  expect(controller.state.noise.last).toMatchObject({ kind: 'confirmed' });
  expect(controller.state.noise.device?.raw).toEqual({ effect: 1, settingType: 1, voice: 0, level: 12 });
});

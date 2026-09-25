/// <reference types="vite/client" />
// Replays hardware captures (docs/device-matrix.md): captured RX frames are
// fed back in the captured order, user actions are repeated at the captured
// points, and the controller must reproduce the captured log, including every
// TX byte, sequence number and ACK.
//
// Provenance: captured on a WH-1000XM5 by the user on 2026-09-25 via the
// in-page diagnostics log. The logs record decoded frames, not raw wire bytes.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Controller } from '../src/app/controller';
import type { NoiseEdit } from '../src/features/noiseControl';
import { encodeFrame } from '../src/protocol/codec';
import { XM5 } from '../src/protocol/profiles';
import h003 from './captures/h003.log?raw';
import h004 from './captures/h004.log?raw';
import { FakeChannel } from './fakeChannel';
import { hex } from './fixtures';

/** 'device-lost' replaces the capture's read failure with the same error. */
type Action = 'attach' | 'refresh' | 'disconnect' | 'device-lost' | NoiseEdit;
interface Line {
  stamp: string;
  text: string;
}

const RX = /^RX type (\d+) seq (\d+) \[([0-9a-f ]*)\]$/;

function parse(capture: string): Line[] {
  const lines = capture
    .trim()
    .split('\n')
    .map((line) => ({ stamp: line.slice(0, 12), text: line.slice(line.indexOf(' ') + 1) }));
  // Lines before the first TX belong to a session that is not in the capture.
  return lines.slice(lines.findIndex((l) => l.text.startsWith('TX ')));
}

async function replay(lines: Line[], actions: Record<string, Action>): Promise<{ produced: string[]; controller: Controller }> {
  const produced: string[] = [];
  const controller = new Controller(XM5, { onLog: (line) => produced.push(line) });
  let channel = new FakeChannel();
  let rxGroup: number[] = [];
  const flush = () => vi.advanceTimersByTimeAsync(0);
  const deliverRx = async () => {
    if (rxGroup.length === 0) return;
    channel.deliver(Uint8Array.from(rxGroup));
    rxGroup = [];
    await flush();
  };

  for (const { stamp, text } of lines) {
    const action = actions[stamp];
    if (action !== undefined) {
      await deliverRx();
      if (action === 'attach') {
        channel = new FakeChannel();
        void controller.attach(channel, 'control');
      } else if (action === 'refresh') void controller.refresh();
      else if (action === 'disconnect') void controller.disconnect();
      else if (action === 'device-lost') channel.failRead(new Error('The device has been lost.'));
      else controller.commit(action);
    }
    const rx = RX.exec(text);
    if (rx) {
      const payload = rx[3] ? hex(rx[3]) : new Uint8Array();
      rxGroup.push(...encodeFrame({ type: Number(rx[1]), seq: Number(rx[2]), payload }));
    } else {
      await deliverRx();
      await flush();
    }
  }
  await deliverRx();
  return { produced, controller };
}

/** Order within each stream is protocol-relevant; interleaving across streams depends on write timing. */
function streams(lines: string[]) {
  return {
    tx: lines.filter((l) => l.startsWith('TX ')),
    rx: lines.filter((l) => l.startsWith('RX ')),
    notes: lines.filter((l) => !l.startsWith('TX ') && !l.startsWith('RX ')),
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('hardware capture replay', () => {
  it('H-003: reproduces the capture exactly, line for line', async () => {
    const lines = parse(h003);
    const { produced, controller } = await replay(lines, {
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
    });
    expect(produced).toEqual(lines.map((l) => l.text));
    expect(controller.state.noise.last).toMatchObject({ kind: 'confirmed' });
    expect(controller.state.noise.device?.raw).toEqual({ effect: 1, settingType: 1, voice: 0, level: 12 });
  });

  it('H-004: levels 1–20, an unknown notification, then power-off', async () => {
    const all = parse(h004);
    // The final line came from the transport cleanup fixed after H-004
    // (cancelling an already-errored stream); the session no longer emits it.
    const cleanup = all.at(-1)!;
    expect(cleanup.text).toContain('cleanup after');
    const lines = all.slice(0, -1);
    const levels: [string, number][] = [
      ['02:41:10.384', 1], ['02:41:12.667', 20], ['02:41:14.333', 18], ['02:41:15.550', 17],
      ['02:41:16.719', 11], ['02:41:17.741', 8], ['02:41:18.733', 6], ['02:41:19.753', 4],
      ['02:41:21.017', 3], ['02:41:24.863', 1], ['02:41:25.931', 2], ['02:41:27.001', 7],
    ];
    const { produced, controller } = await replay(lines, {
      '02:41:08.667': 'attach',
      ...Object.fromEntries(levels.map(([stamp, level]) => [stamp, { level }])),
      '02:41:34.821': 'device-lost',
    });
    expect(streams(produced)).toEqual(streams(lines.map((l) => l.text)));
    // Unknown a5 notification: acknowledged, logged, not applied.
    expect(produced).toContain('unhandled notification [a5 01 00 02 00]');
    // After power-off: idle, device state invalidated, last change still shown as confirmed.
    expect(controller.state.phase).toBe('idle');
    expect(controller.state.noise.device).toBeUndefined();
    expect(controller.state.noise.last).toMatchObject({ kind: 'confirmed', target: { level: 7 } });
  });
});

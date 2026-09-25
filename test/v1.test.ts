import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Controller } from '../src/app/controller';
import { encodeFrame, FrameParser, FrameType } from '../src/protocol/codec';
import { dialectFor } from '../src/protocol/dialect';
import { profileForService, SONY_V1, SONY_V1_SERVICE_UUID, SONY_V2 } from '../src/protocol/profiles';
import { applyEditV1, confirmsV1, getNoiseOperationV1, setNoiseOperationV1, v1Dialect, viewV1, type NoiseRawV1 } from '../src/protocol/v1';
import { FakeChannel } from './fakeChannel';
import { fixtures, hex } from './fixtures';

// Expected payloads marked "upstream" are copied from sony-device-center
// tests/protocol/ProtocolV1Tests.cpp @ dea3896 (upstream-derived fixtures).
// No V1 byte here has been observed on hardware in WebMDR.

const wire = (payload: Uint8Array, seq = 0) => encodeFrame({ type: FrameType.DataMdr, seq, payload });
const get = getNoiseOperationV1();
const decode = (p: string) => get.match(hex(p));
const raw = (p: string): NoiseRawV1 => {
  const m = decode(p);
  if (m.kind !== 'match') throw new Error(`fixture did not match: ${p}`);
  return m.value;
};
const RANGE = SONY_V1.noiseControl.levelWrite;

describe('dialect selection', () => {
  it('follows the selected service, never a model name', () => {
    expect(profileForService(SONY_V1_SERVICE_UUID.toUpperCase())).toBe(SONY_V1);
    expect(profileForService('956C7B26-D49A-4BA8-B03F-B17D393CB6E2')).toBe(SONY_V2);
    // Unknown is not V1.
    expect(profileForService('00000000-deca-fade-deca-deafdecacaff')).toBeUndefined();
    expect(profileForService(undefined)).toBeUndefined();
    expect(dialectFor(SONY_V1).profile).toBe(SONY_V1);
    expect(dialectFor(SONY_V2).init).toBeDefined();
    expect(dialectFor(SONY_V1).init).toBeUndefined();
  });
});

describe('V1 noise GET', () => {
  it('sends 66 02 (upstream codec fixture, seq 1)', () => {
    expect(get.kind).toBe('get');
    expect(get.source).toContain('dea38969b501a4a167f330dff104414531e80eae');
    expect(wire(get.payload, 1)).toEqual(fixtures.upstreamV1Inquiry);
  });

  it('decodes upstream replies by meaning', () => {
    expect(viewV1(raw('67 02 01 02 00 01 01 05'))).toEqual({ mode: 'ambient', level: 5, voice: true }); // upstream
    expect(viewV1(raw('67 02 01 02 02 01 00 00'))).toEqual({ mode: 'noise-cancelling', level: 0, voice: false }); // upstream
    expect(viewV1(raw('67 02 00 02 00 01 00 03'))).toEqual({ mode: 'off', level: 3, voice: false }); // upstream
    expect(viewV1(raw('67 02 11 01 01 01 00 00')).mode).toBe('noise-cancelling'); // single NC
  });

  it('matches subtype and exact schema', () => {
    expect(decode('67 02 01').kind).toBe('malformed'); // upstream
    expect(decode('67 17 01 01 01 00 0c').kind).toBe('no-match'); // a V2 reply is not V1
    expect(decode('67 02 01 02 00 01 01 05 00').kind).toBe('malformed');
    expect(decode('67 02 05 02 00 01 01 05').kind).toBe('malformed'); // unknown effect
    expect(decode('67 02 01 02 03 01 01 05').kind).toBe('malformed'); // unknown dual/single
    expect(decode('67 02 01 02 00 01 01 15').kind).toBe('malformed'); // level 21
  });
});

describe('V1 noise SET', () => {
  const nc = raw('67 02 01 02 02 01 00 00');
  const ambient5 = raw('67 02 01 02 00 01 01 05');
  const payload = (r: NoiseRawV1) => [...setNoiseOperationV1(SONY_V1, r).payload];

  it('encodes what upstream sends', () => {
    expect(payload(applyEditV1(nc, { mode: 'ambient', voice: true, level: 7 }, RANGE))).toEqual([0x68, 0x02, 0x11, 0x01, 0x00, 0x01, 0x01, 7]); // upstream
    expect(payload(applyEditV1(ambient5, { mode: 'noise-cancelling', voice: false }, RANGE))).toEqual([0x68, 0x02, 0x11, 0x01, 0x02, 0x01, 0x00, 0]); // upstream
    expect(payload(applyEditV1(ambient5, { mode: 'off', voice: false }, RANGE))).toEqual([0x68, 0x02, 0x00, 0x01, 0x00, 0x01, 0x00, 0]); // upstream
  });

  it('raises a missing ambient level to the minimum as upstream clamps', () => {
    expect(payload(applyEditV1(nc, { mode: 'ambient' }, RANGE))[7]).toBe(1); // upstream: clamp to 1
  });

  it('keeps untouched fields when only one changes', () => {
    expect(payload(applyEditV1(ambient5, { level: 9 }, RANGE))).toEqual([0x68, 0x02, 0x11, 0x01, 0x00, 0x01, 0x01, 9]);
  });

  it('frames byte for byte (synthetic, independently computed)', () => {
    const op = setNoiseOperationV1(SONY_V1, applyEditV1(nc, { mode: 'ambient', voice: true, level: 7 }, RANGE));
    expect(op.kind).toBe('set');
    expect(wire(op.payload)).toEqual(hex('3e 0c 00 00 00 00 08 68 02 11 01 00 01 01 07 99 3c'));
  });

  it('refuses combinations upstream never sends', () => {
    const ok = applyEditV1(nc, { mode: 'ambient', level: 7 }, RANGE);
    expect(() => setNoiseOperationV1(SONY_V1, { ...ok, level: 20 })).toThrow(RangeError); // V1 write max is 19
    expect(() => setNoiseOperationV1(SONY_V1, { ...ok, dualSingle: 2, level: 5 })).toThrow(RangeError); // level outside ambient
    expect(() => setNoiseOperationV1(SONY_V1, { ...ok, effect: 0x01 })).toThrow(RangeError);
    expect(() => setNoiseOperationV1(SONY_V1, { ...ok, ncSettingType: 2 })).toThrow(RangeError);
  });

  it('confirms by meaning, since the reply reports setting type 02 where the setter sends 01', () => {
    const target = applyEditV1(nc, { mode: 'ambient', voice: true, level: 5 }, RANGE);
    expect(confirmsV1(target, ambient5)).toBe(true);
    expect(confirmsV1(target, raw('67 02 01 02 00 01 01 06'))).toBe(false);
    expect(confirmsV1(applyEditV1(ambient5, { mode: 'off' }, RANGE), raw('67 02 00 02 00 01 01 03'))).toBe(true);
  });

  it('never uses 0x22 (V1 power-off) and has no notification decoding', () => {
    const d = v1Dialect();
    const sent = [d.get().payload, d.set(applyEditV1(nc, { mode: 'ambient', level: 3 }, RANGE)).payload];
    expect(sent.map((p) => p[0])).not.toContain(0x22);
    expect(d.decodeNotification(hex('69 02 01 02 00 01 01 05')).kind).toBe('no-match');
  });
});

/** Synthetic V1 headset driven by the upstream layouts above; not a hardware capture. */
class FakeV1 {
  state = hex('67 02 01 02 02 01 00 00'); // NC
  received: number[][] = [];
  private seq = 1;
  private readonly parser = new FrameParser();
  constructor(readonly channel: FakeChannel) {
    channel.onWrite = (bytes) => {
      for (const e of this.parser.push(bytes)) {
        if (e.kind !== 'frame' || e.frame.type !== FrameType.DataMdr) continue;
        const p = e.frame.payload;
        this.received.push([...p]);
        channel.deliver(encodeFrame({ type: FrameType.Ack, seq: 1 - e.frame.seq, payload: new Uint8Array() }));
        // Report setting type 02, as upstream's fixtures do, whatever was set.
        if (p[0] === 0x68) this.state = Uint8Array.of(0x67, 0x02, p[2]!, 0x02, p[4]!, 0x01, p[6]!, p[7]!);
        if (p[0] === 0x66) this.send(this.state);
        if (p[0] === 0x04) this.send(Uint8Array.of(0x05, 0x02, 0x05, ...Array.from('3.0.1', (ch) => ch.charCodeAt(0))));
      }
    };
  }
  send(payload: Uint8Array): void {
    this.channel.deliver(encodeFrame({ type: FrameType.DataMdr, seq: this.seq, payload }));
    this.seq ^= 1;
  }
}

describe('controller over V1', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('becomes ready from a valid state reply without any init, changes and confirms', async () => {
    const channel = new FakeChannel();
    const device = new FakeV1(channel);
    const controller = new Controller({ timeoutMs: 1000 });
    await controller.attach(channel, 'control', SONY_V1);
    expect(device.received).toEqual([[0x66, 0x02], [0x04, 0x02]]);
    expect(controller.state.phase).toBe('ready');
    expect(controller.state.firmware).toEqual({ status: 'known', version: '3.0.1' });
    // V1 writes are untested on hardware: nothing is sent without the explicit opt-in.
    expect(controller.canChange).toBe(false);
    expect(controller.needsOptIn).toBe(true);
    controller.commit({ mode: 'ambient', level: 12 });
    await vi.advanceTimersByTimeAsync(0);
    expect(device.received).toHaveLength(2);
    controller.allowUnverifiedWrites(true);
    expect(controller.view(controller.state.noise.device!.raw)).toEqual({ mode: 'noise-cancelling', level: 0, voice: false });

    controller.commit({ mode: 'ambient', level: 12 });
    await vi.advanceTimersByTimeAsync(0);
    expect(device.received.slice(2)).toEqual([[0x68, 0x02, 0x11, 0x01, 0x00, 0x01, 0x00, 12], [0x66, 0x02]]);
    expect(controller.state.noise.last).toMatchObject({ kind: 'confirmed' });
    expect(device.received.flat()).not.toContain(0x22);
  });

  it('does not adopt an unreviewed V1 notification', async () => {
    const channel = new FakeChannel();
    const device = new FakeV1(channel);
    const lines: string[] = [];
    const controller = new Controller({ onLog: (l) => lines.push(l) });
    await controller.attach(channel, 'read-only', SONY_V1);
    const before = controller.state.noise.device;
    device.send(hex('69 02 01 02 00 01 01 05'));
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.state.noise.device).toBe(before);
    expect(lines).toContain('unhandled notification [69 02 01 02 00 01 01 05]');
  });
});

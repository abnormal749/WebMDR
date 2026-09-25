import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Controller } from '../src/app/controller';
import { encodeFrame, FrameParser, FrameType } from '../src/protocol/codec';
import { SONY_V2 } from '../src/protocol/profiles';
import type { NoiseRaw } from '../src/features/noiseControl';
import { FakeChannel } from './fakeChannel';

/** Synthetic device model driven by the V2 layouts under test; not a hardware capture. */
class FakeXm5 {
  state: NoiseRaw = { effect: 1, settingType: 0, voice: 0, level: 7 };
  deviceSeq = 0;
  silent = new Set<number>(); // opcodes to ignore entirely
  applySets = true;
  answersFirmware = true; // ACKs 04 02 either way
  received: number[][] = [];
  private readonly parser = new FrameParser();

  constructor(readonly channel: FakeChannel) {
    channel.onWrite = (bytes) => {
      for (const e of this.parser.push(bytes)) if (e.kind === 'frame') this.onFrame(e.frame.type, e.frame.seq, e.frame.payload);
    };
  }

  notify(raw: NoiseRaw): void {
    this.state = raw;
    this.send([0x69, 0x17, 0x01, raw.effect, raw.settingType, raw.voice, raw.level]);
  }

  private onFrame(type: number, seq: number, p: Uint8Array): void {
    if (type !== FrameType.DataMdr) return;
    this.received.push(Array.from(p));
    if (this.silent.has(p[0]!)) return;
    this.channel.deliver(encodeFrame({ type: FrameType.Ack, seq: 1 - seq, payload: new Uint8Array() }));
    if (p[0] === 0x00) this.send([0x01, 0x00, 0x03, 0x00, 0x20, 0x16, 0x00, 0x00]); // H-003 reply
    if (p[0] === 0x66) this.send([0x67, 0x17, 0x01, this.state.effect, this.state.settingType, this.state.voice, this.state.level]);
    if (p[0] === 0x04 && this.answersFirmware) this.send([0x05, 0x02, 0x05, ...Array.from('2.5.1', (ch) => ch.charCodeAt(0))]);
    if (p[0] === 0x68 && this.applySets) this.state = { effect: p[3]!, settingType: p[4]!, voice: p[5]!, level: p[6]! };
  }

  private send(payload: number[]): void {
    this.channel.deliver(encodeFrame({ type: FrameType.DataMdr, seq: this.deviceSeq, payload: Uint8Array.from(payload) }));
    this.deviceSeq ^= 1;
  }
}

const flush = () => vi.advanceTimersByTimeAsync(0);
let channel: FakeChannel;
let device: FakeXm5;
let controller: Controller;

beforeEach(() => {
  vi.useFakeTimers();
  channel = new FakeChannel();
  device = new FakeXm5(channel);
  controller = new Controller({ timeoutMs: 1000 });
});
afterEach(() => vi.useRealTimers());

describe('read-only session', () => {
  it('becomes ready only after init reply and a valid state read, and sends no setter', async () => {
    await controller.attach(channel, 'read-only', SONY_V2);
    expect(controller.state.phase).toBe('ready');
    expect(controller.state.noise.device).toEqual({ raw: device.state, via: 'reply' });
    expect(device.received).toEqual([[0x00, 0x00], [0x66, 0x17], [0x04, 0x02]]);
    expect(controller.canChange).toBe(false);
    controller.commit({ level: 3 });
    await flush();
    expect(device.received.some((p) => p[0] === 0x68)).toBe(false);
    expect(controller.state.noise.last?.kind).toBe('not-sent');
  });

  it('does not become ready when initialization gets no reply', async () => {
    device.silent.add(0x00);
    const attached = controller.attach(channel, 'control', SONY_V2);
    await vi.advanceTimersByTimeAsync(1000);
    await attached;
    expect(controller.state.phase).toBe('failed');
    expect(controller.canChange).toBe(false);
    // Ambiguous timeout: no automatic retry, no GET afterwards.
    expect(device.received).toEqual([[0x00, 0x00]]);
  });

  it('does not become ready on a malformed state reply', async () => {
    device.state = { effect: 1, settingType: 1, voice: 0, level: 99 };
    await controller.attach(channel, 'control', SONY_V2);
    expect(controller.state.phase).toBe('failed');
    expect(controller.state.noise.device).toBeUndefined();
  });

  it('passive mode sends nothing and still decodes notifications', async () => {
    await controller.attach(channel, 'passive', SONY_V2);
    device.notify({ effect: 0, settingType: 0, voice: 0, level: 4 });
    await flush();
    expect(channel.written).toEqual([]);
    expect(controller.state.phase).toBe('observing');
    expect(controller.state.noise.device?.via).toBe('notification');
  });

  it('never uses 0x22 (V1 power-off) in any flow', async () => {
    await controller.attach(channel, 'control', SONY_V2);
    controller.commit({ mode: 'ambient', level: 5 });
    await flush();
    await controller.refresh();
    expect(device.received.every((p) => p[0] !== 0x22)).toBe(true);
  });
});

describe('firmware version', () => {
  it('is read once after the state read', async () => {
    await controller.attach(channel, 'read-only', SONY_V2);
    expect(controller.state.firmware).toEqual({ status: 'known', version: '2.5.1' });
  });

  it('a headset that ACKs but never answers stays fully usable', async () => {
    device.answersFirmware = false;
    const attached = controller.attach(channel, 'control', SONY_V2);
    await vi.advanceTimersByTimeAsync(1000);
    await attached;
    expect(controller.state.phase).toBe('ready');
    expect(controller.state.firmware?.status).toBe('unavailable');
    controller.commit({ mode: 'off' });
    await flush();
    expect(controller.state.noise.last?.kind).toBe('confirmed');
    expect(device.received.filter((p) => p[0] === 0x04)).toHaveLength(1); // never retried
  });

  it('sends a change committed while the firmware read is still pending', async () => {
    device.answersFirmware = false;
    const attached = controller.attach(channel, 'control', SONY_V2);
    await flush();
    expect(controller.state.phase).toBe('ready');
    controller.commit({ level: 4 });
    expect(device.received.some((p) => p[0] === 0x68)).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    await attached;
    await flush();
    expect(device.received.filter((p) => p[0] === 0x68).at(-1)).toEqual([0x68, 0x17, 0x01, 1, 0, 0, 4]);
  });
});

describe('noise-control change', () => {
  beforeEach(async () => {
    await controller.attach(channel, 'control', SONY_V2);
  });

  it('sends the merged state, preserving untouched fields, and confirms by fresh read', async () => {
    device.state = { effect: 1, settingType: 0, voice: 1, level: 9 };
    await controller.refresh();
    controller.commit({ mode: 'ambient' });
    await flush();
    // voice and raw level kept although ambient was inactive when read.
    expect(device.received.at(-2)).toEqual([0x68, 0x17, 0x01, 1, 1, 1, 9]);
    expect(device.received.at(-1)).toEqual([0x66, 0x17]);
    expect(controller.state.noise.last).toMatchObject({ kind: 'confirmed', receipt: { ack: 'valid', writeCompleted: true } });
    expect(controller.state.noise.device?.raw).toEqual({ effect: 1, settingType: 1, voice: 1, level: 9 });
  });

  it('keeps one in-flight change and only the latest merged pending edit', async () => {
    device.silent.add(0x68);
    controller.commit({ mode: 'ambient', level: 3 });
    await flush();
    device.silent.delete(0x68);
    controller.commit({ level: 4 });
    controller.commit({ level: 5 });
    controller.commit({ voice: true });
    expect(controller.state.noise.queued).toEqual({ level: 5, voice: true });
    expect(device.received.filter((p) => p[0] === 0x68)).toHaveLength(1);
  });

  it('a live drag sends the first and the final position only, not the path between', async () => {
    controller.commit({ mode: 'ambient', level: 5 });
    await flush();
    const g = new Promise<void>((r) => setTimeout(r, 50));
    channel.writeGate = g; // hold the next change in flight while the "drag" continues
    controller.commit({ level: 6 });
    for (let level = 7; level <= 15; level++) controller.commit({ level });
    expect(controller.state.noise.queued).toEqual({ level: 15 });
    channel.writeGate = undefined;
    await vi.advanceTimersByTimeAsync(60);
    await flush();
    const levels = device.received.filter((p) => p[0] === 0x68).map((p) => p[6]);
    expect(levels).toEqual([5, 6, 15]);
    expect(controller.state.noise.last).toMatchObject({ kind: 'confirmed', target: { level: 15 } });
  });

  it('never publishes a state with the edit neither queued nor in flight before confirmation', async () => {
    // A UI that re-syncs its controls from device state in such a gap would read
    // back the old value and send it as a new change (found in the browser).
    const gaps: string[] = [];
    let armed = false;
    controller.subscribe((s) => {
      if (armed && s.noise.last?.kind !== 'confirmed' && !s.noise.queued && !s.noise.inFlight) gaps.push(JSON.stringify(s.noise));
    });
    armed = true;
    controller.commit({ mode: 'ambient', level: 19 });
    await flush();
    armed = false;
    expect(controller.state.noise.last?.kind).toBe('confirmed');
    expect(gaps).toEqual([]);
  });

  it('sends the pending edit after the in-flight one is confirmed', async () => {
    const g = new Promise<void>((r) => setTimeout(r, 10));
    channel.writeGate = g;
    controller.commit({ mode: 'ambient', level: 3 });
    controller.commit({ level: 6 });
    await vi.advanceTimersByTimeAsync(20);
    channel.writeGate = undefined;
    await flush();
    await flush();
    const sets = device.received.filter((p) => p[0] === 0x68);
    expect(sets).toEqual([
      [0x68, 0x17, 0x01, 1, 1, 0, 3],
      [0x68, 0x17, 0x01, 1, 1, 0, 6],
    ]);
    expect(controller.state.noise.last?.kind).toBe('confirmed');
  });

  it('reports an ambiguous setter timeout as unknown and does not retry', async () => {
    device.silent.add(0x68);
    controller.commit({ mode: 'off' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(controller.state.noise.last).toMatchObject({ kind: 'unknown' });
    expect(controller.state.phase).toBe('failed');
    expect(controller.canChange).toBe(false);
    controller.commit({ mode: 'off' });
    await flush();
    expect(device.received.filter((p) => p[0] === 0x68)).toHaveLength(1);
  });

  it('shows a mismatch when the read-back differs instead of claiming success', async () => {
    device.applySets = false;
    controller.commit({ mode: 'off' });
    await flush();
    expect(controller.state.noise.last).toMatchObject({ kind: 'mismatch', reported: device.state });
    expect(controller.state.noise.device?.raw).toEqual(device.state);
    expect(device.received.filter((p) => p[0] === 0x68)).toHaveLength(1);
  });

  it('adopts an external change when nothing is pending, and does not re-enforce the old state', async () => {
    controller.commit({ mode: 'ambient', level: 10 });
    await flush();
    const setsBefore = device.received.filter((p) => p[0] === 0x68).length;
    device.notify({ effect: 1, settingType: 0, voice: 0, level: 10 }); // physical button: back to NC
    await flush();
    expect(controller.state.noise.device).toEqual({ raw: { effect: 1, settingType: 0, voice: 0, level: 10 }, via: 'notification' });
    expect(device.received.filter((p) => p[0] === 0x68)).toHaveLength(setsBefore);
  });

  it('applies a later edit on top of an externally changed field', async () => {
    device.notify({ effect: 1, settingType: 1, voice: 1, level: 2 });
    await flush();
    controller.commit({ level: 8 });
    await flush();
    expect(device.received.filter((p) => p[0] === 0x68).at(-1)).toEqual([0x68, 0x17, 0x01, 1, 1, 1, 8]);
  });

  it('refuses to encode an out-of-range level without sending', async () => {
    controller.commit({ mode: 'ambient', level: 21 });
    await flush();
    expect(controller.state.noise.last?.kind).toBe('not-sent');
    expect(device.received.some((p) => p[0] === 0x68)).toBe(false);
  });

  it('on disconnect: rejects in-flight work, invalidates state, clears queued edits, replays nothing', async () => {
    device.silent.add(0x68);
    controller.commit({ mode: 'ambient', level: 3 });
    controller.commit({ level: 9 });
    await flush();
    channel.end();
    await flush();
    expect(controller.state.phase).toBe('idle');
    expect(controller.state.noise.device).toBeUndefined();
    expect(controller.state.noise.queued).toBeUndefined();
    expect(controller.state.noise.last?.kind).toBe('unknown');

    const next = new FakeChannel();
    const nextDevice = new FakeXm5(next);
    await controller.attach(next, 'control', SONY_V2);
    expect(nextDevice.received).toEqual([[0x00, 0x00], [0x66, 0x17], [0x04, 0x02]]);
    expect(controller.state.noise.last).toBeUndefined();
  });

  it('ignores late results from an old connection', async () => {
    device.silent.add(0x68);
    controller.commit({ mode: 'off' });
    await flush();
    await controller.disconnect();
    const next = new FakeChannel();
    new FakeXm5(next);
    await controller.attach(next, 'read-only', SONY_V2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(controller.state.phase).toBe('ready');
    expect(controller.state.mode).toBe('read-only');
  });
});

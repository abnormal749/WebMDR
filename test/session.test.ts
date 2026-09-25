import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeFrame, FrameType } from '../src/protocol/codec';
import { SONY_V2 } from '../src/protocol/profiles';
import { Session, SessionError, type SessionEvent, type SessionMode } from '../src/protocol/session';
import { getNoiseOperation, setNoiseOperation } from '../src/protocol/v2';
import { FakeChannel, gate } from './fakeChannel';
import { fixtures, hex } from './fixtures';

const data = (seq: number, payload: string) => encodeFrame({ type: FrameType.DataMdr, seq, payload: hex(payload) });
const ack = (seq: number) => encodeFrame({ type: FrameType.Ack, seq, payload: new Uint8Array() });
const REPLY = '67 17 01 01 01 00 0c';
const AMBIENT_12 = { effect: 1, settingType: 1, voice: 0, level: 12 };
const flush = () => vi.advanceTimersByTimeAsync(0);

let channel: FakeChannel;
let events: SessionEvent[];

function open(mode: SessionMode = 'read-only'): Session {
  return new Session(channel, { mode, timeoutMs: 1000, onEvent: (e) => events.push(e) });
}

async function expectError(promise: Promise<unknown>, code: string, outcome: string): Promise<void> {
  const error = await promise.then(() => undefined, (e: unknown) => e);
  expect(error).toBeInstanceOf(SessionError);
  expect(error).toMatchObject({ code, outcome });
}

beforeEach(() => {
  vi.useFakeTimers();
  channel = new FakeChannel();
  events = [];
});
afterEach(() => vi.useRealTimers());

describe('transactions', () => {
  it('sends the exact GET bytes and completes on ACK then reply', async () => {
    const session = open();
    const result = session.request(getNoiseOperation(SONY_V2));
    expect(channel.written).toEqual([fixtures.noiseGet]);
    channel.deliver(ack(1), fixtures.noiseReplyAmbient12);
    await expect(result).resolves.toEqual({
      value: AMBIENT_12,
      receipt: { seq: 0, writeCompleted: true, ack: 'valid' },
    });
    // Host ACKs the reply (seq 1) with 1 - 1 = 0.
    expect(channel.written[1]).toEqual(fixtures.upstreamAck0);
  });

  it('completes on reply before ACK, and records the late ACK on the same receipt', async () => {
    const session = open();
    const p = session.request(getNoiseOperation(SONY_V2));
    channel.deliver(fixtures.noiseReplyAmbient12);
    const done = await p;
    expect(done.receipt.ack).toBe('none');
    channel.deliver(ack(1));
    await flush();
    expect(done.receipt.ack).toBe('valid');
    expect(events.some((e) => e.type === 'stray-ack')).toBe(false);
  });

  it('accepts a reply delivered synchronously during the write', async () => {
    const session = open();
    channel.onWrite = (bytes) => {
      if (bytes[7] === 0x66) channel.deliver(fixtures.noiseReplyAmbient12);
    };
    await expect(session.request(getNoiseOperation(SONY_V2))).resolves.toMatchObject({ value: AMBIENT_12 });
  });

  it('never uses a reply received before the request as a fresh result', async () => {
    const session = open();
    channel.deliver(fixtures.noiseReplyAmbient12);
    await flush();
    expect(events.filter((e) => e.type === 'notification')).toHaveLength(1);

    const result = session.request(getNoiseOperation(SONY_V2));
    vi.advanceTimersByTime(1000);
    await expectError(result, 'timeout', 'unknown');
    expect(session.state).toBe('desynchronized');

    // No automatic retry, and no further requests until reconnect.
    const writes = channel.written.length;
    await expectError(session.request(getNoiseOperation(SONY_V2)), 'desynchronized', 'not-sent');
    expect(channel.written.length).toBe(writes);
  });

  it('ignores a wrong subtype and unrelated notifications while waiting', async () => {
    const session = open();
    const result = session.request(getNoiseOperation(SONY_V2));
    channel.deliver(data(1, '67 18 01 01 01 00 0c'), data(0, '69 17 01 00 00 01 05'), data(1, REPLY));
    await expect(result).resolves.toMatchObject({ value: AMBIENT_12 });
    const notes = events.flatMap((e) => (e.type === 'notification' ? [e.frame.payload[1]] : []));
    expect(notes).toEqual([0x18, 0x17]);
  });

  it('rejects a malformed reply with the right opcode and subtype', async () => {
    const session = open();
    const result = session.request(getNoiseOperation(SONY_V2));
    channel.deliver(data(1, '67 17 01 01 01 00'));
    await expectError(result, 'malformed', 'replied');
    expect(session.state).toBe('open');
  });

  it('rejects out-of-range and unknown enum values', async () => {
    const session = open();
    let result = session.request(getNoiseOperation(SONY_V2));
    channel.deliver(data(1, '67 17 01 01 01 00 15'));
    await expectError(result, 'malformed', 'replied');
    result = session.request(getNoiseOperation(SONY_V2));
    channel.deliver(data(0, '67 17 01 11 01 00 05'));
    await expectError(result, 'malformed', 'replied');
  });

  it('allows one transaction at a time without queueing', async () => {
    const session = open();
    const first = session.request(getNoiseOperation(SONY_V2));
    await expectError(session.request(getNoiseOperation(SONY_V2)), 'busy', 'not-sent');
    expect(channel.written).toHaveLength(1);
    channel.deliver(fixtures.noiseReplyAmbient12);
    await first;
  });

  it('alternates the TX sequence after each completed transaction', async () => {
    const session = open();
    const first = session.request(getNoiseOperation(SONY_V2));
    channel.deliver(ack(1), fixtures.noiseReplyAmbient12);
    await first;
    const second = session.request(getNoiseOperation(SONY_V2));
    expect(channel.written.at(-1)).toEqual(hex('3e 0c 01 00 00 00 02 66 17 8c 3c'));
    channel.deliver(ack(0), data(0, REPLY));
    await expect(second).resolves.toMatchObject({ receipt: { seq: 1, ack: 'valid' } });
  });
});

describe('duplicates and ACKs', () => {
  it('ACKs a duplicate again but applies it only once', async () => {
    open();
    const note = data(0, '69 17 01 00 00 01 05');
    channel.deliver(note, note);
    await flush();
    expect(events.filter((e) => e.type === 'notification')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'duplicate')).toHaveLength(1);
    expect(channel.sentFrames()).toEqual([
      { type: 1, seq: 1, payload: new Uint8Array() },
      { type: 1, seq: 1, payload: new Uint8Array() },
    ]);
  });

  it('treats the same sequence with a different payload as new data', async () => {
    open();
    channel.deliver(data(0, '69 17 01 00 00 01 05'), data(0, '69 17 01 00 00 01 06'));
    await flush();
    expect(events.filter((e) => e.type === 'notification')).toHaveLength(2);
  });

  it('completes a setter only on the ACK the audited dialect implies', async () => {
    const session = open('control');
    const result = session.command(setNoiseOperation(SONY_V2, AMBIENT_12));
    expect(channel.written[0]).toEqual(hex('3e 0c 00 00 00 00 07 68 17 01 01 01 00 0c a1 3c'));
    channel.deliver(ack(1));
    await expect(result).resolves.toEqual({ receipt: { seq: 0, writeCompleted: true, ack: 'valid' } });
  });

  it('does not accept an echoed-sequence ACK as receipt; the setter outcome becomes unknown', async () => {
    const session = open('control');
    const result = session.command(setNoiseOperation(SONY_V2, AMBIENT_12));
    channel.deliver(ack(0));
    await flush();
    vi.advanceTimersByTime(1000);
    await expectError(result, 'timeout', 'unknown');
    expect(session.state).toBe('desynchronized');
  });

  it('reports an ACK with nothing outstanding as stray', async () => {
    open();
    channel.deliver(ack(1));
    await flush();
    expect(events).toContainEqual({ type: 'stray-ack', seq: 1 });
  });

  it('does not interpret or acknowledge unknown frame families', async () => {
    open();
    channel.deliver(encodeFrame({ type: 0x0e, seq: 0, payload: hex('67 17 01 01 01 00 0c') }));
    await flush();
    expect(events.some((e) => e.type === 'unhandled-frame')).toBe(true);
    expect(channel.written).toEqual([]);
  });
});

describe('modes', () => {
  it('read-only refuses setting changes without writing', async () => {
    const session = open('read-only');
    expect(() => setNoiseOperation(SONY_V2, AMBIENT_12)).not.toThrow();
    await expectError(session.command(setNoiseOperation(SONY_V2, AMBIENT_12)), 'mode', 'not-sent');
    expect(channel.written).toEqual([]);
  });

  it('passive mode sends nothing, not even ACKs', async () => {
    const session = open('passive');
    await expectError(session.request(getNoiseOperation(SONY_V2)), 'mode', 'not-sent');
    channel.deliver(fixtures.notifyNcVoice5);
    await flush();
    expect(events.some((e) => e.type === 'notification')).toBe(true);
    expect(channel.written).toEqual([]);
  });
});

describe('writer scheduling', () => {
  it('writes ACKs ahead of queued data, one complete frame at a time', async () => {
    const session = open();
    const g = gate();
    channel.writeGate = g.promise;
    channel.deliver(data(0, '69 17 01 00 00 01 05')); // its ACK write blocks
    await flush();
    const result = session.request(getNoiseOperation(SONY_V2)); // queued behind the blocked ACK
    channel.deliver(data(1, '69 17 01 00 00 01 06')); // second ACK jumps ahead of the queued request
    await flush();
    channel.writeGate = undefined;
    g.open();
    await flush();
    expect(channel.written).toEqual([ack(1), ack(0), fixtures.noiseGet]);
    channel.deliver(data(0, REPLY));
    await expect(result).resolves.toMatchObject({ value: AMBIENT_12 });
  });

  it('does not match a reply that arrives while the request is still queued, not yet written', async () => {
    const session = open();
    const g = gate();
    channel.writeGate = g.promise;
    channel.deliver(data(0, '69 17 01 00 00 01 05'));
    await flush();
    const result = session.request(getNoiseOperation(SONY_V2)).then((r) => r.value);
    channel.deliver(data(1, '67 17 01 01 01 00 03')); // cannot answer an unsent request
    await flush();
    channel.writeGate = undefined;
    g.open();
    await flush();
    channel.deliver(data(0, REPLY));
    await expect(result).resolves.toEqual(AMBIENT_12);
  });

  it('keeps RX flowing while a transaction waits', async () => {
    const session = open();
    const result = session.request(getNoiseOperation(SONY_V2));
    for (let i = 0; i < 5; i++) channel.deliver(data(i & 1, `69 17 01 00 00 01 0${i}`));
    channel.deliver(data(1, REPLY));
    await expect(result).resolves.toMatchObject({ value: AMBIENT_12 });
    expect(channel.sentFrames().filter((f) => f.type === FrameType.Ack)).toHaveLength(6);
  });

  it('withdraws a request that times out before transmission and stays usable', async () => {
    const session = open();
    const g = gate();
    channel.writeGate = g.promise;
    channel.deliver(data(0, '69 17 01 00 00 01 05'));
    await flush();
    const result = session.request(getNoiseOperation(SONY_V2));
    vi.advanceTimersByTime(1000);
    await expectError(result, 'timeout', 'not-sent');
    channel.writeGate = undefined;
    g.open();
    await flush();
    expect(channel.written).toEqual([ack(1)]);
    expect(session.state).toBe('open');
  });
});

describe('lifecycle', () => {
  it('closes during a pending read and pending request', async () => {
    const session = open();
    const result = session.request(getNoiseOperation(SONY_V2));
    await flush();
    await session.close();
    await expectError(result, 'disconnected', 'unknown');
    expect(session.state).toBe('closed');
    expect(channel.closeCalls).toBe(1);
    await expect(session.closed).resolves.toBe('closed by user');
    await expectError(session.request(getNoiseOperation(SONY_V2)), 'closed', 'not-sent');
  });

  it('close is idempotent', async () => {
    const session = open();
    await Promise.all([session.close(), session.close()]);
    expect(channel.closeCalls).toBe(1);
  });

  it('treats the end of the stream as disconnect and rejects pending work', async () => {
    const session = open();
    const result = session.request(getNoiseOperation(SONY_V2));
    channel.end();
    await expectError(result, 'disconnected', 'unknown');
    await expect(session.closed).resolves.toBe('device closed the stream');
  });

  it('closes on a read failure', async () => {
    const session = open();
    await flush();
    channel.failRead(new Error('NetworkError'));
    await expect(session.closed).resolves.toBe('read failed: NetworkError');
  });

  it('closes when a started write fails', async () => {
    const session = open();
    channel.writeError = new Error('write broke');
    const result = session.request(getNoiseOperation(SONY_V2));
    await expectError(result, 'disconnected', 'unknown');
    await expect(session.closed).resolves.toBe('write failed: write broke');
  });

  it('ignores a write completing after the session closed', async () => {
    const session = open();
    const g = gate();
    channel.writeGate = g.promise;
    const result = session.request(getNoiseOperation(SONY_V2)).catch((e: unknown) => e);
    await flush();
    await session.close();
    g.open();
    await flush();
    const error = await result;
    expect(error).toMatchObject({ code: 'disconnected' });
    expect(session.state).toBe('closed');
  });

  it('propagates cleanup failures instead of hiding them', async () => {
    const session = open();
    channel.closeError = new Error('close failed');
    await expect(session.close()).rejects.toThrow('close failed');
    expect(session.state).toBe('closed');
  });
});

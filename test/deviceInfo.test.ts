import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeFrame, FrameType } from '../src/protocol/codec';
import { firmwareOperation } from '../src/protocol/deviceInfo';
import { SONY_V2 } from '../src/protocol/profiles';
import { Session } from '../src/protocol/session';
import { getNoiseOperation } from '../src/protocol/v2';
import { FakeChannel } from './fakeChannel';
import { fixtures, hex } from './fixtures';

const ack = (seq: number) => encodeFrame({ type: FrameType.Ack, seq, payload: new Uint8Array() });
const data = (seq: number, payload: string) => encodeFrame({ type: FrameType.DataMdr, seq, payload: hex(payload) });

describe('firmware query', () => {
  const op = firmwareOperation('sony-v2');

  it('sends 04 02 byte for byte (synthetic, independently computed)', () => {
    expect(op).toMatchObject({ kind: 'get', optional: true, dialect: 'sony-v2' });
    expect(firmwareOperation('sony-v1').payload).toEqual(op.payload);
    expect(encodeFrame({ type: FrameType.DataMdr, seq: 0, payload: op.payload })).toEqual(hex('3e 0c 00 00 00 00 02 04 02 14 3c'));
  });

  it('reads 05 02 <length> <ASCII>', () => {
    expect(op.match(hex('05 02 05 32 2e 35 2e 31'))).toEqual({ kind: 'match', value: '2.5.1' });
    expect(op.match(hex('05 03 05 32 2e 35 2e 31')).kind).toBe('no-match');
    expect(op.match(hex('05 02 00 32 2e 30 2e 31')).kind).toBe('malformed'); // upstream's V2 test fixture has length 0
    expect(op.match(hex('05 02 02 32 00')).kind).toBe('malformed');
    expect(op.match(hex('05 02')).kind).toBe('malformed');
  });
});

describe('optional query timeout', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('ACKed without a reply: ends that request only; the session stays usable', async () => {
    const channel = new FakeChannel();
    const session = new Session(channel, { mode: 'read-only', timeoutMs: 1000 });
    const result = session.request(firmwareOperation('sony-v2')).catch((e: unknown) => e);
    channel.deliver(ack(1));
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toMatchObject({ code: 'timeout', outcome: 'unknown' });
    expect(session.state).toBe('open');
    // A late firmware reply is not mistaken for the next request's reply.
    const next = session.request(getNoiseOperation(SONY_V2));
    expect(channel.written.at(-1)).toEqual(hex('3e 0c 01 00 00 00 02 66 17 8c 3c'));
    channel.deliver(ack(0), data(1, '05 02 05 32 2e 35 2e 31'), data(0, '67 17 01 01 01 00 0c'));
    await expect(next).resolves.toMatchObject({ value: { level: 12 } });
  });

  it('without an ACK the outcome is ambiguous and the session desynchronizes as before', async () => {
    const channel = new FakeChannel();
    const session = new Session(channel, { mode: 'read-only', timeoutMs: 1000 });
    const result = session.request(firmwareOperation('sony-v2')).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toMatchObject({ code: 'timeout', outcome: 'unknown' });
    expect(session.state).toBe('desynchronized');
  });

  it('a non-optional request still desynchronizes even when ACKed', async () => {
    const channel = new FakeChannel();
    const session = new Session(channel, { mode: 'read-only', timeoutMs: 1000 });
    const result = session.request(getNoiseOperation(SONY_V2)).catch((e: unknown) => e);
    channel.deliver(ack(1));
    await vi.advanceTimersByTimeAsync(1000);
    await result;
    expect(session.state).toBe('desynchronized');
    expect(channel.written).toEqual([fixtures.noiseGet, ...[]]);
  });
});

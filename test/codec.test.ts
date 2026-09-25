import { describe, expect, it } from 'vitest';
import { encodeFrame, FrameParser, FrameType, MAX_ENCODED_FRAME, MAX_PAYLOAD, type ParseEvent } from '../src/protocol/codec';
import { fixtures, hex } from './fixtures';

const frames = (events: ParseEvent[]) => events.filter((e) => e.kind === 'frame').map((e) => e.frame);
const errors = (events: ParseEvent[]) => events.filter((e) => e.kind === 'error').map((e) => e.error);

describe('encodeFrame against independent fixtures', () => {
  it.each([
    ['upstream V1 inquiry', { type: FrameType.DataMdr, seq: 1, payload: hex('66 02') }, fixtures.upstreamV1Inquiry],
    ['upstream ACK', { type: FrameType.Ack, seq: 0, payload: new Uint8Array() }, fixtures.upstreamAck0],
    ['V2 init', { type: FrameType.DataMdr, seq: 0, payload: hex('00 00') }, fixtures.init],
    ['escaped payload', { type: FrameType.DataMdr, seq: 0, payload: hex('3c 3d 3e') }, fixtures.escapedPayload],
    ['escaped checksum', { type: FrameType.DataMdr, seq: 0, payload: hex('30') }, fixtures.escapedChecksum],
  ])('%s', (_name, frame, wire) => {
    expect(encodeFrame(frame)).toEqual(wire);
  });

  it('rejects non-byte header fields and oversized payloads', () => {
    expect(() => encodeFrame({ type: 256, seq: 0, payload: new Uint8Array() })).toThrow();
    expect(() => encodeFrame({ type: 12, seq: -1, payload: new Uint8Array() })).toThrow();
    expect(() => encodeFrame({ type: 12, seq: 0, payload: new Uint8Array(MAX_PAYLOAD + 1) })).toThrow();
    // Escaping can push a legal payload length over the encoded bound.
    expect(() => encodeFrame({ type: 12, seq: 0, payload: new Uint8Array(MAX_PAYLOAD).fill(0x3c) })).toThrow();
  });
});

describe('FrameParser', () => {
  it('decodes independent fixtures', () => {
    const parser = new FrameParser();
    expect(frames(parser.push(fixtures.noiseReplyAmbient12))).toEqual([
      { type: 0x0c, seq: 1, payload: hex('67 17 01 01 01 00 0c') },
    ]);
    expect(frames(parser.push(fixtures.escapedPayload))[0]!.payload).toEqual(hex('3c 3d 3e'));
    expect(frames(parser.push(fixtures.escapedChecksum))[0]!.payload).toEqual(hex('30'));
    expect(frames(parser.push(fixtures.upstreamAck0))).toEqual([{ type: 1, seq: 0, payload: new Uint8Array() }]);
  });

  it.each(Object.entries(fixtures))('decodes %s identically at every split point', (_name, wire) => {
    const whole = frames(new FrameParser().push(wire));
    expect(whole).toHaveLength(1);
    for (let i = 0; i <= wire.length; i++) {
      for (let j = i; j <= wire.length; j++) {
        const parser = new FrameParser();
        const events = [...parser.push(wire.slice(0, i)), ...parser.push(wire.slice(i, j)), ...parser.push(wire.slice(j))];
        expect(errors(events)).toEqual([]);
        expect(frames(events)).toEqual(whole);
      }
    }
  });

  it('decodes one byte at a time, including between an escape and its code', () => {
    const parser = new FrameParser();
    const events = Array.from(fixtures.escapedPayload).flatMap((b) => parser.push(Uint8Array.of(b)));
    expect(frames(events)[0]!.payload).toEqual(hex('3c 3d 3e'));
  });

  it('returns several frames from one chunk in order', () => {
    const chunk = new Uint8Array([...fixtures.ack1, ...fixtures.noiseReplyAmbient12, ...fixtures.notifyNcVoice5]);
    expect(frames(new FrameParser().push(chunk)).map((f) => f.payload[0] ?? 'ack')).toEqual(['ack', 0x67, 0x69]);
  });

  it('reports garbage and still decodes the following frame', () => {
    const events = new FrameParser().push(new Uint8Array([0x00, 0x3c, 0x99, ...fixtures.ack1]));
    expect(errors(events)).toEqual(['garbage']);
    expect(frames(events)).toHaveLength(1);
  });

  it('drops a truncated frame and recovers at the next start marker', () => {
    const cut = fixtures.noiseReplyAmbient12.slice(0, 9);
    const events = new FrameParser().push(new Uint8Array([...cut, ...fixtures.ack1]));
    expect(errors(events)).toEqual(['truncated']);
    expect(frames(events)).toEqual([{ type: 1, seq: 1, payload: new Uint8Array() }]);
  });

  it('rejects checksum failures', () => {
    const bad = fixtures.noiseGet.slice();
    bad[bad.length - 2] = bad[bad.length - 2]! ^ 1;
    expect(errors(new FrameParser().push(bad))).toEqual(['checksum']);
    const badPayload = fixtures.noiseGet.slice();
    badPayload[7] = badPayload[7]! ^ 1;
    expect(errors(new FrameParser().push(badPayload))).toEqual(['checksum']);
  });

  it('rejects invalid escapes, including an escape directly before a delimiter', () => {
    expect(errors(new FrameParser().push(hex('3e 0c 00 3d 00 3c')))).toEqual(['invalid-escape']);
    expect(errors(new FrameParser().push(hex('3e 0c 00 3d 3c')))).toEqual(['invalid-escape']);
    // Escape followed by a start marker: current frame invalid, the new one decodes.
    const events = new FrameParser().push(new Uint8Array([0x3e, 0x0c, 0x3d, ...fixtures.ack1]));
    expect(errors(events)).toEqual(['invalid-escape']);
    expect(frames(events)).toHaveLength(1);
  });

  it('requires the exact decoded length (upstream accepts trailing bytes)', () => {
    // fixture with an extra byte between checksum and end marker
    const extra = hex('3e 0c 00 00 00 00 02 66 17 8b 00 3c');
    expect(errors(new FrameParser().push(extra))).toEqual(['length-mismatch']);
    const short = hex('3e 0c 00 00 00 00 03 66 17 8b 3c');
    expect(errors(new FrameParser().push(short))).toEqual(['length-mismatch']);
    expect(errors(new FrameParser().push(hex('3e 0c 00 00 3c')))).toEqual(['too-short']);
  });

  it('rejects an oversized declared length as soon as the header is read', () => {
    const parser = new FrameParser();
    expect(errors(parser.push(hex('3e 0c 00 7f ff ff ff')))).toEqual(['oversized']);
    // Remaining bytes of that frame are discarded without further errors; next frame decodes.
    const events = parser.push(new Uint8Array([0x01, 0x02, 0x3c, ...fixtures.ack1]));
    expect(errors(events)).toEqual([]);
    expect(frames(events)).toHaveLength(1);
  });

  it('bounds an endless unterminated frame and recovers', () => {
    const parser = new FrameParser();
    const header = hex('3e 0c 00 00 00 00 10');
    const flood = new Uint8Array(MAX_ENCODED_FRAME * 4).fill(0x11);
    const events = [...parser.push(header), ...parser.push(flood)];
    expect(errors(events)).toEqual(['oversized']);
    expect(frames(parser.push(fixtures.ack1))).toHaveLength(1);
  });

  it('accepts a maximum-size frame', () => {
    const payload = new Uint8Array(MAX_PAYLOAD).fill(0x41);
    const wire = encodeFrame({ type: 12, seq: 0, payload });
    expect(wire.length).toBe(MAX_ENCODED_FRAME);
    expect(frames(new FrameParser().push(wire))[0]!.payload).toEqual(payload);
  });
});

import { describe, expect, it } from 'vitest';
import { applyEdit, mergeEdits, modeOf } from '../src/features/noiseControl';
import { encodeFrame, FrameType } from '../src/protocol/codec';
import { SONY_V2 } from '../src/protocol/profiles';
import { decodeNoiseNotification, getNoiseOperation, initOperation, setNoiseOperation } from '../src/protocol/v2';
import { fixtures, hex } from './fixtures';

const wire = (payload: Uint8Array, seq = 0) => encodeFrame({ type: FrameType.DataMdr, seq, payload });

describe('every outbound V2 operation, byte for byte', () => {
  it('init: 00 00', () => {
    const op = initOperation();
    expect(op).toMatchObject({ kind: 'init', dialect: 'sony-v2' });
    expect(op.source).toContain('dea38969b501a4a167f330dff104414531e80eae');
    expect(wire(op.payload)).toEqual(fixtures.init);
  });

  it('noise GET: 66 17', () => {
    const op = getNoiseOperation(SONY_V2);
    expect(op.kind).toBe('get');
    expect(wire(op.payload)).toEqual(fixtures.noiseGet);
  });

  it('noise SET: 68 17 01 effect type voice level', () => {
    const op = setNoiseOperation(SONY_V2, { effect: 1, settingType: 1, voice: 0, level: 12 });
    expect(op.kind).toBe('set');
    expect(wire(op.payload, 1)).toEqual(fixtures.noiseSetAmbient12);
  });

  it('SET validates enums and the profile write range', () => {
    const ok = { effect: 1, settingType: 1, voice: 0, level: 1 };
    expect(() => setNoiseOperation(SONY_V2, ok)).not.toThrow();
    expect(() => setNoiseOperation(SONY_V2, { ...ok, level: 0 })).toThrow(RangeError);
    expect(() => setNoiseOperation(SONY_V2, { ...ok, level: 21 })).toThrow(RangeError);
    expect(() => setNoiseOperation(SONY_V2, { ...ok, effect: 0x11 })).toThrow(RangeError);
    expect(() => setNoiseOperation(SONY_V2, { ...ok, voice: 2 })).toThrow(RangeError);
  });

  it('no operation uses opcode 0x22', () => {
    const ops = [initOperation(), getNoiseOperation(SONY_V2), setNoiseOperation(SONY_V2, { effect: 0, settingType: 0, voice: 0, level: 1 })];
    expect(ops.map((o) => o.payload[0])).not.toContain(0x22);
  });
});

describe('reply and notification schemas', () => {
  const match = getNoiseOperation(SONY_V2).match;
  it('matches opcode, subtype and exact schema', () => {
    expect(match(hex('67 17 01 00 00 01 05'))).toEqual({ kind: 'match', value: { effect: 0, settingType: 0, voice: 1, level: 5 } });
    expect(match(hex('67 18 01 00 00 01 05')).kind).toBe('no-match');
    expect(match(hex('69 17 01 00 00 01 05')).kind).toBe('no-match');
    expect(match(hex('67 17 01 00 00 01 05 00')).kind).toBe('malformed');
    expect(match(hex('67 17 02 00 00 01 05')).kind).toBe('malformed');
  });

  it('init reply: opcode 01, exactly 8 bytes, returned raw', () => {
    const captured = hex('01 00 03 00 20 16 00 00'); // H-003
    expect(initOperation().match(captured)).toEqual({ kind: 'match', value: captured });
    expect(initOperation().match(hex('01 00 aa')).kind).toBe('malformed');
    expect(initOperation().match(hex('02 00')).kind).toBe('no-match');
  });

  it('decodes a 69 17 notification only', () => {
    expect(decodeNoiseNotification(hex('69 17 01 00 00 01 05'), SONY_V2).kind).toBe('match');
    expect(decodeNoiseNotification(hex('67 17 01 00 00 01 05'), SONY_V2).kind).toBe('no-match');
  });
});

describe('noise-control merge', () => {
  const base = { effect: 1, settingType: 0, voice: 1, level: 9 };
  it('changes only edited fields and keeps inactive raw values', () => {
    expect(applyEdit(base, { mode: 'ambient' })).toEqual({ effect: 1, settingType: 1, voice: 1, level: 9 });
    expect(applyEdit(base, { level: 3 })).toEqual({ ...base, level: 3 });
    expect(applyEdit(base, { voice: false })).toEqual({ ...base, voice: 0 });
    expect(applyEdit(base, { mode: 'off' })).toEqual({ effect: 0, settingType: 0, voice: 1, level: 9 });
  });
  it('derives mode from raw bytes', () => {
    expect(modeOf({ ...base, effect: 0, settingType: 1 })).toBe('off');
    expect(modeOf(base)).toBe('noise-cancelling');
    expect(modeOf({ ...base, settingType: 1 })).toBe('ambient');
  });
  it('merges later edits over earlier ones field by field', () => {
    expect(mergeEdits({ mode: 'ambient', level: 3 }, { level: 5 })).toEqual({ mode: 'ambient', level: 5 });
  });
});

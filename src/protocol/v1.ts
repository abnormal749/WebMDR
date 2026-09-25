// Sony V1 (legacy service) noise control. Every payload here has a byte-level
// test in test/v1.test.ts. Layouts are source-derived and NOT tested on hardware
// in WebMDR.
//
// Deliberately absent: opcode 0x22, which the audited V1 source identifies as
// POWER OFF. There is no V1 initialization exchange (upstream's initDevice only
// polls the state GET, which the controller performs anyway), and no V1 change
// notification is interpreted: upstream does not parse one.

import type { NoiseEdit, NoiseState } from '../features/noiseControl';
import type { NoiseDialect } from './dialect';
import { SONY_V1, type Profile, type Range } from './profiles';
import type { CommandOperation, Match, RequestOperation } from './session';

const SOURCE = 'marconvcm/sony-device-center libs/sony-protocol/src/ProtocolV1.cpp @ dea38969b501a4a167f330dff104414531e80eae';

const Opcode = { NoiseGet: 0x66, NoiseReply: 0x67, NoiseSet: 0x68 } as const;

const EFFECT_OFF = 0x00;
const EFFECT_ADJUSTMENT_COMPLETION = 0x11; // what upstream sends for "on"
const LEVEL_ADJUSTMENT = 0x01;
const DUAL_SINGLE_OFF = 0x00; // ambient sound
const DUAL = 0x02; // noise cancelling

/** 67 02 <effect> <ncSettingType> <dualSingle> <asmSettingType> <asmId> <asmLevel> */
export interface NoiseRawV1 {
  effect: number;
  ncSettingType: number;
  dualSingle: number;
  asmSettingType: number;
  asmId: number; // 1 = voice
  level: number;
}

const oneOf = (values: readonly number[]) => (v: number) => values.includes(v);
const READ_ENUMS: Record<Exclude<keyof NoiseRawV1, 'level'>, (v: number) => boolean> = {
  effect: oneOf([0x00, 0x01, 0x10, 0x11]), // upstream NC_ASM_EFFECT
  ncSettingType: oneOf([0, 1, 2]), // NC_ASM_SETTING_TYPE
  dualSingle: oneOf([0, 1, 2]), // NC_DUAL_SINGLE_VALUE
  asmSettingType: oneOf([0, 1]), // ASM_SETTING_TYPE
  asmId: oneOf([0, 1]), // ASM_ID
};

function inRange(v: number, r: Range): boolean {
  return Number.isInteger(v) && v >= r.min && v <= r.max;
}

function invalidRead(raw: NoiseRawV1, level: Range): string | undefined {
  for (const [field, ok] of Object.entries(READ_ENUMS) as [keyof typeof READ_ENUMS, (v: number) => boolean][]) {
    if (!ok(raw[field])) return `unknown ${field} ${raw[field]}`;
  }
  return inRange(raw.level, level) ? undefined : `level ${raw.level} out of range`;
}

export function viewV1(raw: NoiseRawV1): NoiseState {
  const mode = raw.effect === EFFECT_OFF ? 'off' : raw.dualSingle === DUAL_SINGLE_OFF ? 'ambient' : 'noise-cancelling';
  return { mode, level: raw.level, voice: raw.asmId === 1 };
}

export function getNoiseOperationV1(profile: Profile = SONY_V1): RequestOperation<NoiseRawV1> {
  const { inquiry, levelRead } = profile.noiseControl;
  return {
    id: 'v1.noise.get',
    kind: 'get',
    purpose: 'Read noise-control state',
    source: `${SOURCE} ProtocolV1::getNoiseControl`,
    dialect: 'sony-v1',
    payload: Uint8Array.of(Opcode.NoiseGet, inquiry),
    match: (p): Match<NoiseRawV1> => {
      if (p[0] !== Opcode.NoiseReply || p[1] !== inquiry) return { kind: 'no-match' };
      if (p.length !== 8) return { kind: 'malformed', reason: `expected 8 payload bytes, got ${p.length}` };
      const raw: NoiseRawV1 = { effect: p[2]!, ncSettingType: p[3]!, dualSingle: p[4]!, asmSettingType: p[5]!, asmId: p[6]!, level: p[7]! };
      const problem = invalidRead(raw, levelRead);
      return problem ? { kind: 'malformed', reason: problem } : { kind: 'match', value: raw };
    },
  };
}

/** Only the byte combinations upstream's setter produces are sent. */
export function setNoiseOperationV1(profile: Profile, raw: NoiseRawV1): CommandOperation {
  const { inquiry, levelWrite } = profile.noiseControl;
  const refuse = (why: string) => new RangeError(`refusing to encode V1 noise setting: ${why}`);
  if (raw.effect !== EFFECT_OFF && raw.effect !== EFFECT_ADJUSTMENT_COMPLETION) throw refuse(`effect ${raw.effect}`);
  if (raw.ncSettingType !== LEVEL_ADJUSTMENT || raw.asmSettingType !== LEVEL_ADJUSTMENT) throw refuse('setting types');
  if (raw.dualSingle !== DUAL_SINGLE_OFF && raw.dualSingle !== DUAL) throw refuse(`dual/single ${raw.dualSingle}`);
  if (raw.asmId !== 0 && raw.asmId !== 1) throw refuse(`asm id ${raw.asmId}`);
  const ambient = raw.effect !== EFFECT_OFF && raw.dualSingle === DUAL_SINGLE_OFF;
  if (ambient ? !inRange(raw.level, levelWrite) : raw.level !== 0) throw refuse(`level ${raw.level}`);
  return {
    id: 'v1.noise.set',
    kind: 'set',
    purpose: 'Change noise-control state',
    source: `${SOURCE} ProtocolV1::setNoiseControl`,
    dialect: 'sony-v1',
    payload: Uint8Array.of(Opcode.NoiseSet, inquiry, raw.effect, raw.ncSettingType, raw.dualSingle, raw.asmSettingType, raw.asmId, raw.level),
  };
}

/**
 * Encodes the edited state the way ProtocolV1::setNoiseControl does: level 0
 * outside ambient ("what the headset echoes back on GET"), and a level below
 * the write minimum raised to it when switching to ambient (upstream clamps).
 */
export function applyEditV1(base: NoiseRawV1, edit: NoiseEdit, levelWrite: Range): NoiseRawV1 {
  const current = viewV1(base);
  const mode = edit.mode ?? current.mode;
  const voice = edit.voice ?? current.voice;
  const requested = edit.level ?? current.level;
  const ambient = mode === 'ambient';
  return {
    effect: mode === 'off' ? EFFECT_OFF : EFFECT_ADJUSTMENT_COMPLETION,
    ncSettingType: LEVEL_ADJUSTMENT,
    dualSingle: ambient || mode === 'off' ? DUAL_SINGLE_OFF : DUAL,
    asmSettingType: LEVEL_ADJUSTMENT,
    asmId: voice ? 1 : 0,
    level: ambient ? Math.max(requested, levelWrite.min) : 0,
  };
}

/** The reply's setting-type bytes may differ from what the setter sends (upstream tests), so compare meaning. */
export function confirmsV1(target: NoiseRawV1, readBack: NoiseRawV1): boolean {
  const t = viewV1(target);
  const r = viewV1(readBack);
  return t.mode === r.mode && t.voice === r.voice && (t.mode !== 'ambient' || t.level === r.level);
}

export function v1Dialect(profile: Profile = SONY_V1): NoiseDialect<NoiseRawV1> {
  return {
    profile,
    get: () => getNoiseOperationV1(profile),
    set: (raw) => setNoiseOperationV1(profile, raw),
    decodeNotification: () => ({ kind: 'no-match' }),
    isReply: (p) => p[0] === Opcode.NoiseReply,
    view: viewV1,
    apply: (base, edit) => applyEditV1(base, edit, profile.noiseControl.levelWrite),
    confirms: confirmsV1,
  };
}

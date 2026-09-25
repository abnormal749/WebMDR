// Sony V2 operations used by WebMDR. Every payload here has a byte-level test
// in test/v2.test.ts. Layouts are source-derived, not hardware-verified.
//
// Deliberately absent: opcode 0x22 (V2 battery). The audited V1 source
// identifies 0x22 as power-off, so it is never used as a probe.

import { invalidRaw, type NoiseRaw } from '../features/noiseControl';
import type { Profile } from './profiles';
import type { CommandOperation, Match, RequestOperation } from './session';

const SOURCE = 'marconvcm/sony-device-center libs/sony-protocol/src/ProtocolV2.cpp @ dea38969b501a4a167f330dff104414531e80eae';

const Opcode = {
  InitRequest: 0x00,
  InitReply: 0x01,
  NoiseGet: 0x66,
  NoiseReply: 0x67,
  NoiseSet: 0x68,
  /** Treated as a noise notification by upstream DeviceEventDispatcher.cpp. */
  NoiseNotify: 0x69,
} as const;

/** Upstream Constants.h: "8 bytes total => v2 device"; H-003 observed exactly 8 on an XM5. */
const INIT_REPLY_LENGTH = 8;

/**
 * Host initialization: 00 00 -> 01 + 7 bytes. The body's meaning is not
 * documented upstream, so it is length-checked and returned raw.
 */
export function initOperation(): RequestOperation<Uint8Array> {
  return {
    id: 'v2.init',
    kind: 'init',
    purpose: 'V2 host initialization',
    source: `${SOURCE} ProtocolV2::initDevice`,
    dialect: 'sony-v2',
    payload: Uint8Array.of(Opcode.InitRequest, 0x00),
    match: (p) => {
      if (p[0] !== Opcode.InitReply) return { kind: 'no-match' };
      if (p.length !== INIT_REPLY_LENGTH) return { kind: 'malformed', reason: `expected ${INIT_REPLY_LENGTH}-byte init reply, got ${p.length}` };
      return { kind: 'match', value: p.slice() };
    },
  };
}

export function getNoiseOperation(profile: Profile): RequestOperation<NoiseRaw> {
  const { inquiry, levelRead } = profile.noiseControl;
  return {
    id: 'v2.noise.get',
    kind: 'get',
    purpose: 'Read noise-control state',
    source: `${SOURCE} ProtocolV2::getNoiseControl`,
    dialect: 'sony-v2',
    payload: Uint8Array.of(Opcode.NoiseGet, inquiry),
    match: (p) => decodeNoise(p, Opcode.NoiseReply, inquiry, levelRead),
  };
}

export function setNoiseOperation(profile: Profile, raw: NoiseRaw): CommandOperation {
  const { inquiry, levelWrite } = profile.noiseControl;
  const problem = invalidRaw(raw, levelWrite);
  if (problem) throw new RangeError(`refusing to encode noise setting: ${problem}`);
  return {
    id: 'v2.noise.set',
    kind: 'set',
    purpose: 'Change noise-control state',
    source: `${SOURCE} ProtocolV2::setNoiseControl`,
    dialect: 'sony-v2',
    payload: Uint8Array.of(Opcode.NoiseSet, inquiry, 0x01, raw.effect, raw.settingType, raw.voice, raw.level),
  };
}

/** Decodes a 69 notification; no-match for any other payload. */
export function decodeNoiseNotification(payload: Uint8Array, profile: Profile): Match<NoiseRaw> {
  return decodeNoise(payload, Opcode.NoiseNotify, profile.noiseControl.inquiry, profile.noiseControl.levelRead);
}

/** True for an unrequested 67 reply: it must not be applied as fresh state. */
export function isNoiseReply(payload: Uint8Array): boolean {
  return payload[0] === Opcode.NoiseReply;
}

function decodeNoise(p: Uint8Array, opcode: number, inquiry: number, level: Profile['noiseControl']['levelRead']): Match<NoiseRaw> {
  if (p[0] !== opcode || p[1] !== inquiry) return { kind: 'no-match' };
  if (p.length !== 7) return { kind: 'malformed', reason: `expected 7 payload bytes, got ${p.length}` };
  if (p[2] !== 0x01) return { kind: 'malformed', reason: `unexpected byte 2: ${p[2]}` };
  const raw: NoiseRaw = { effect: p[3]!, settingType: p[4]!, voice: p[5]!, level: p[6]! };
  const problem = invalidRaw(raw, level);
  return problem ? { kind: 'malformed', reason: problem } : { kind: 'match', value: raw };
}

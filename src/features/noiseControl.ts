// Noise-control state. The V2 setter carries mode, voice focus and level
// together, so edits are merged onto the latest device-reported state.

import type { Range } from '../protocol/profiles';

/** Raw device bytes from 67/69 17 01 <effect> <settingType> <voice> <level>. */
export interface NoiseRaw {
  effect: number;      // 0 off, 1 on
  settingType: number; // 0 noise cancelling, 1 ambient
  voice: number;       // 0 / 1
  level: number;       // kept even while ambient is inactive
}

export type NoiseMode = 'off' | 'noise-cancelling' | 'ambient';

export interface NoiseEdit {
  mode?: NoiseMode;
  level?: number;
  voice?: boolean;
}

export function modeOf(raw: NoiseRaw): NoiseMode {
  if (raw.effect === 0) return 'off';
  return raw.settingType === 1 ? 'ambient' : 'noise-cancelling';
}

/** Returns a reason if a device-reported state is outside the profile's enums/ranges. */
export function invalidRaw(raw: NoiseRaw, level: Range): string | undefined {
  if (raw.effect !== 0 && raw.effect !== 1) return `unknown effect ${raw.effect}`;
  if (raw.settingType !== 0 && raw.settingType !== 1) return `unknown setting type ${raw.settingType}`;
  if (raw.voice !== 0 && raw.voice !== 1) return `unknown voice value ${raw.voice}`;
  if (!Number.isInteger(raw.level) || raw.level < level.min || raw.level > level.max) return `level ${raw.level} out of range`;
  return undefined;
}

/** Applies only the edited fields; everything else keeps its raw device value. */
export function applyEdit(base: NoiseRaw, edit: NoiseEdit): NoiseRaw {
  const next = { ...base };
  if (edit.mode !== undefined) {
    // Byte pairs follow ProtocolV2::setNoiseControl @ dea3896 (Off sends type 0).
    next.effect = edit.mode === 'off' ? 0 : 1;
    next.settingType = edit.mode === 'ambient' ? 1 : 0;
  }
  if (edit.level !== undefined) next.level = edit.level;
  if (edit.voice !== undefined) next.voice = edit.voice ? 1 : 0;
  return next;
}

/** A later edit replaces the same field of an earlier one; untouched fields survive. */
export function mergeEdits(earlier: NoiseEdit | undefined, later: NoiseEdit): NoiseEdit {
  return { ...earlier, ...later };
}

export function sameRaw(a: NoiseRaw, b: NoiseRaw): boolean {
  return a.effect === b.effect && a.settingType === b.settingType && a.voice === b.voice && a.level === b.level;
}

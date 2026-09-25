// What the controller needs from one dialect's noise-control encoding. Each
// dialect keeps its own raw byte layout; only this narrow surface is shared.

import type { NoiseEdit, NoiseState } from '../features/noiseControl';
import type { Profile } from './profiles';
import type { CommandOperation, Match, RequestOperation } from './session';

export interface NoiseDialect<Raw> {
  profile: Profile;
  /** Reviewed initialization exchange, if the dialect has one. */
  init?: () => RequestOperation<Uint8Array>;
  get: () => RequestOperation<Raw>;
  /** Throws RangeError for values outside the profile's enums or write range. */
  set: (raw: Raw) => CommandOperation;
  /** Device-initiated change notification; 'no-match' where none is reviewed. */
  decodeNotification: (payload: Uint8Array) => Match<Raw>;
  /** A reply opcode that must not be applied when it arrives unrequested. */
  isReply: (payload: Uint8Array) => boolean;
  view: (raw: Raw) => NoiseState;
  /** The raw state the setter will send for `edit` applied to `base`. */
  apply: (base: Raw, edit: NoiseEdit) => Raw;
  /** Whether a fresh read-back confirms that `target` took effect. */
  confirms: (target: Raw, readBack: Raw) => boolean;
}

import { v1Dialect } from './v1';
import { v2Dialect } from './v2';

/** The encoding for a profile. Chosen by service UUID, never by probing. */
export function dialectFor(profile: Profile): NoiseDialect<unknown> {
  return (profile.dialect === 'sony-v1' ? v1Dialect(profile) : v2Dialect(profile)) as NoiseDialect<unknown>;
}

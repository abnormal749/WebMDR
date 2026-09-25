/*!
 * Frame format, escape table and checksum translated from Sony Device Center
 * libs/sony-protocol/src/FrameCodec.cpp @ dea38969b501a4a167f330dff104414531e80eae
 * Copyright (c) 2020 Nir Harel, Mor Gal, Sem Visscher, jimzrt, guilhermealbm, and other contributors
 * MIT License — see THIRD_PARTY_NOTICES.md. Modifications are listed in docs/reuse-manifest.md.
 */

// Wire format (docs/technical-review.md §3):
//   3e | escape(type:u8, seq:u8, payloadLength:u32be, payload, checksum:u8) | 3c
// checksum = low 8 bits of the sum of unescaped type, seq, length bytes and payload.

export const START = 0x3e;
export const END = 0x3c;
export const ESCAPE = 0x3d;

/** Upstream MAX_FRAME_SIZE: whole encoded frame including delimiters. */
export const MAX_ENCODED_FRAME = 2048;
const HEADER = 6; // type + seq + u32 length
const MIN_BODY = HEADER + 1; // + checksum
/** Largest decoded body a frame of MAX_ENCODED_FRAME bytes can carry. */
const MAX_DECODED_BODY = MAX_ENCODED_FRAME - 2;
export const MAX_PAYLOAD = MAX_DECODED_BODY - MIN_BODY;

/** Frame families from upstream DataType.h. Only these two are interpreted. */
export const FrameType = {
  Ack: 0x01,
  DataMdr: 0x0c,
} as const;

export interface Frame {
  type: number;
  seq: number;
  payload: Uint8Array;
}

export class FrameEncodeError extends Error {}

function escapedByte(b: number): number | undefined {
  switch (b) {
    case END: return 0x2c;
    case ESCAPE: return 0x2d;
    case START: return 0x2e;
    default: return undefined;
  }
}

function unescapedByte(b: number): number | undefined {
  switch (b) {
    case 0x2c: return END;
    case 0x2d: return ESCAPE;
    case 0x2e: return START;
    default: return undefined;
  }
}

export function checksum(bytes: Uint8Array): number {
  let sum = 0;
  for (const b of bytes) sum = (sum + b) & 0xff;
  return sum;
}

function isByte(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 0xff;
}

export function encodeFrame(frame: Frame): Uint8Array {
  const { type, seq, payload } = frame;
  if (!isByte(type) || !isByte(seq)) throw new FrameEncodeError('type and seq must be bytes');
  if (payload.length > MAX_PAYLOAD) throw new FrameEncodeError(`payload exceeds ${MAX_PAYLOAD} bytes`);

  const body = new Uint8Array(MIN_BODY + payload.length);
  body[0] = type;
  body[1] = seq;
  new DataView(body.buffer).setUint32(2, payload.length, false);
  body.set(payload, HEADER);
  body[body.length - 1] = checksum(body.subarray(0, body.length - 1));

  const out: number[] = [START];
  for (const b of body) {
    const esc = escapedByte(b);
    if (esc === undefined) out.push(b);
    else out.push(ESCAPE, esc);
  }
  out.push(END);
  if (out.length > MAX_ENCODED_FRAME) throw new FrameEncodeError(`encoded frame exceeds ${MAX_ENCODED_FRAME} bytes`);
  return Uint8Array.from(out);
}

export type ParseError =
  | 'garbage'          // bytes outside a frame
  | 'truncated'        // a new start marker arrived before the current frame ended
  | 'invalid-escape'
  | 'oversized'        // encoded body or declared length exceeds the bound
  | 'too-short'
  | 'length-mismatch'  // decoded body is not exactly 6 + length + 1
  | 'checksum';

export type ParseEvent =
  | { kind: 'frame'; frame: Frame }
  | { kind: 'error'; error: ParseError; dropped: number };

/**
 * Incremental parser. Memory is bounded by one preallocated decoded body;
 * any error discards the current frame and resynchronizes at the next start marker.
 */
export class FrameParser {
  private readonly body = new Uint8Array(MAX_DECODED_BODY);
  private inFrame = false;
  private escapePending = false;
  private decodedLen = 0;
  private encodedLen = 0; // body bytes seen, for the encoded-size bound and error reports
  private garbage = 0;
  private discarding = false; // frame already rejected; skip until next start marker

  push(chunk: Uint8Array): ParseEvent[] {
    const events: ParseEvent[] = [];
    for (const b of chunk) this.pushByte(b, events);
    this.flushGarbage(events);
    return events;
  }

  private pushByte(b: number, events: ParseEvent[]): void {
    if (b === START) {
      this.flushGarbage(events);
      if (this.inFrame && !this.discarding) {
        events.push({ kind: 'error', error: this.escapePending ? 'invalid-escape' : 'truncated', dropped: this.encodedLen + 1 });
      }
      this.beginFrame();
      return;
    }
    if (!this.inFrame) {
      this.garbage++;
      return;
    }
    if (b === END) {
      if (!this.discarding) events.push(this.finishFrame());
      this.inFrame = false;
      this.discarding = false;
      return;
    }
    if (this.discarding) return;

    this.encodedLen++;
    if (this.encodedLen + 2 > MAX_ENCODED_FRAME) return this.reject('oversized', events);

    let value = b;
    if (this.escapePending) {
      const u = unescapedByte(b);
      if (u === undefined) return this.reject('invalid-escape', events);
      this.escapePending = false;
      value = u;
    } else if (b === ESCAPE) {
      this.escapePending = true;
      return;
    }

    // encodedLen bound implies decodedLen < body.length.
    this.body[this.decodedLen++] = value;
    if (this.decodedLen === HEADER && this.declaredLength() > MAX_PAYLOAD) {
      this.reject('oversized', events);
    }
  }

  private beginFrame(): void {
    this.inFrame = true;
    this.discarding = false;
    this.escapePending = false;
    this.decodedLen = 0;
    this.encodedLen = 0;
  }

  private reject(error: ParseError, events: ParseEvent[]): void {
    events.push({ kind: 'error', error, dropped: this.encodedLen + 1 });
    this.discarding = true;
  }

  private declaredLength(): number {
    return new DataView(this.body.buffer).getUint32(2, false);
  }

  private finishFrame(): ParseEvent {
    const dropped = this.encodedLen + 2;
    if (this.escapePending) return { kind: 'error', error: 'invalid-escape', dropped };
    if (this.decodedLen < MIN_BODY) return { kind: 'error', error: 'too-short', dropped };
    const length = this.declaredLength();
    if (this.decodedLen !== MIN_BODY + length) return { kind: 'error', error: 'length-mismatch', dropped };
    const end = HEADER + length;
    if (checksum(this.body.subarray(0, end)) !== this.body[end]) return { kind: 'error', error: 'checksum', dropped };
    return {
      kind: 'frame',
      frame: { type: this.body[0]!, seq: this.body[1]!, payload: this.body.slice(HEADER, end) },
    };
  }

  private flushGarbage(events: ParseEvent[]): void {
    if (this.garbage > 0) {
      events.push({ kind: 'error', error: 'garbage', dropped: this.garbage });
      this.garbage = 0;
    }
  }
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
}

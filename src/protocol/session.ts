// Sony protocol session. Written for WebMDR; it does not translate upstream
// SonyProtocolSession.cpp (see docs/technical-review.md §2 and §4 for why).
//
// Audited dialect facts this relies on (SonyProtocolSession.cpp @ dea3896):
//  - the host acknowledges a data frame with sequence 1 - (seq & 1);
//  - the host adopts a device ACK's sequence (0 or 1) as its next TX sequence.
// WebMDR therefore expects the device's ACK for TX sequence s to carry 1 - s.
// This is source-derived, not hardware-verified: ACK status is recorded
// separately and a GET completes on its validated reply, not on the ACK.

import { encodeFrame, FrameParser, FrameType, type Frame, type ParseError } from './codec';

/** Minimal byte stream the session owns for one connection. */
export interface ByteChannel {
  read(): Promise<{ done: true; value?: undefined } | { done: false; value: Uint8Array }>;
  write(bytes: Uint8Array): Promise<void>;
  /** Must make a pending read() settle. */
  close(): Promise<void>;
}

export type SessionMode = 'passive' | 'read-only' | 'control';
export type OperationKind = 'init' | 'get' | 'set';

export type Match<T> =
  | { kind: 'no-match' }
  | { kind: 'match'; value: T }
  | { kind: 'malformed'; reason: string };

interface OperationInfo {
  /** Stable identifier, e.g. "v2.noise.get". */
  id: string;
  kind: OperationKind;
  purpose: string;
  /** Upstream file/commit or other evidence for the byte layout. */
  source: string;
  dialect: 'sony-v2';
  payload: Uint8Array;
}

/** An operation completed by a matching DataMdr reply. */
export interface RequestOperation<T> extends OperationInfo {
  kind: 'init' | 'get';
  match(payload: Uint8Array): Match<T>;
}

/** An operation completed by protocol receipt (ACK) alone. */
export interface CommandOperation extends OperationInfo {
  kind: 'set';
}

export type AckStatus = 'none' | 'valid' | 'mismatch';

/** Separate outcomes: browser write, protocol receipt. Device state is not implied. */
export interface Receipt {
  seq: number;
  writeCompleted: boolean;
  ack: AckStatus;
}

export type SessionErrorCode =
  | 'busy' | 'mode' | 'closed' | 'desynchronized'   // nothing was sent
  | 'timeout' | 'disconnected' | 'malformed';

/** not-sent: no bytes left the page. unknown: the device may or may not have acted. */
export type Outcome = 'not-sent' | 'unknown' | 'replied';

export class SessionError extends Error {
  constructor(
    readonly code: SessionErrorCode,
    readonly outcome: Outcome,
    message: string,
  ) {
    super(message);
    this.name = 'SessionError';
  }
}

export type SessionState = 'open' | 'desynchronized' | 'closing' | 'closed';

export type SessionEvent =
  | { type: 'tx'; frame: Frame; purpose: string }
  | { type: 'rx'; frame: Frame }
  | { type: 'parse-error'; error: ParseError; dropped: number }
  | { type: 'notification'; frame: Frame }
  | { type: 'duplicate'; frame: Frame }
  | { type: 'stray-ack'; seq: number }
  | { type: 'unhandled-frame'; frame: Frame }
  | { type: 'state'; state: SessionState; reason?: string };

export interface SessionOptions {
  mode: SessionMode;
  timeoutMs?: number;
  onEvent?: (event: SessionEvent) => void;
}

interface Pending {
  op: OperationInfo;
  match?: (payload: Uint8Array) => Match<unknown>;
  receipt: Receipt;
  writeStarted: boolean;
  /** Identifies this operation's queued write so a timeout can withdraw it. */
  onStart: () => void;
  timer: ReturnType<typeof setTimeout>;
  resolve(value: unknown): void;
  reject(error: SessionError): void;
}

interface WriteItem {
  bytes: Uint8Array;
  onStart?: () => void;
  resolve(): void;
  reject(error: unknown): void;
}

const DEFAULT_TIMEOUT_MS = 1500;

export const ackSeqFor = (seq: number): number => 1 - (seq & 1);

export class Session {
  readonly mode: SessionMode;
  private readonly timeoutMs: number;
  private readonly emit: (event: SessionEvent) => void;
  private readonly parser = new FrameParser();

  private _state: SessionState = 'open';
  /** Incremented on close; callbacks from an older epoch are ignored. */
  private epoch = 0;
  private txSeq = 0;
  private lastTx: Receipt | undefined;
  private lastRx: Frame | undefined;
  private pending: Pending | undefined;

  private readonly ackQueue: WriteItem[] = [];
  private readonly dataQueue: WriteItem[] = [];
  private pumping = false;

  private readonly rxLoop: Promise<void>;
  private closing: Promise<void> | undefined;
  /** Resolves with the reason once the session has fully closed. */
  readonly closed: Promise<string>;
  private resolveClosed!: (reason: string) => void;

  constructor(private readonly channel: ByteChannel, options: SessionOptions) {
    this.mode = options.mode;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.emit = options.onEvent ?? (() => {});
    this.closed = new Promise((resolve) => (this.resolveClosed = resolve));
    this.rxLoop = this.runRxLoop();
  }

  get state(): SessionState {
    return this._state;
  }

  get busy(): boolean {
    return this.pending !== undefined;
  }

  request<T>(op: RequestOperation<T>): Promise<{ value: T; receipt: Receipt }> {
    return this.transact(op, op.match) as Promise<{ value: T; receipt: Receipt }>;
  }

  command(op: CommandOperation): Promise<{ receipt: Receipt }> {
    return this.transact(op, undefined) as Promise<{ receipt: Receipt }>;
  }

  private transact(op: OperationInfo, match: Pending['match']): Promise<unknown> {
    const refusal = this.refusal(op);
    if (refusal) return Promise.reject(refusal);

    // Encode before registering so an invalid frame never becomes pending.
    const frame: Frame = { type: FrameType.DataMdr, seq: this.txSeq, payload: op.payload };
    const bytes = encodeFrame(frame);
    const epoch = this.epoch;

    return new Promise((resolve, reject) => {
      const pending: Pending = {
        op,
        receipt: { seq: frame.seq, writeCompleted: false, ack: 'none' },
        writeStarted: false,
        onStart: () => {
          pending.writeStarted = true;
          this.emit({ type: 'tx', frame, purpose: op.purpose });
        },
        timer: setTimeout(() => this.onTimeout(pending), this.timeoutMs),
        resolve,
        reject,
        ...(match ? { match } : {}),
      };
      // Register the matcher before the write can trigger RX.
      this.pending = pending;
      this.enqueue(this.dataQueue, bytes, pending.onStart).then(
        () => {
          if (epoch === this.epoch) pending.receipt.writeCompleted = true;
        },
        (error: unknown) => {
          // A withdrawn or dropped write never started; only a started write is a transport failure.
          if (epoch === this.epoch && pending.writeStarted) this.fail(`write failed: ${describe(error)}`);
        },
      );
    });
  }

  private refusal(op: OperationInfo): SessionError | undefined {
    if (this._state === 'closing' || this._state === 'closed') return new SessionError('closed', 'not-sent', 'session is closed');
    if (this._state === 'desynchronized') {
      return new SessionError('desynchronized', 'not-sent', 'an earlier outcome is unknown; reconnect before sending');
    }
    if (this.mode === 'passive') return new SessionError('mode', 'not-sent', 'passive mode sends nothing');
    if (op.kind === 'set' && this.mode !== 'control') {
      return new SessionError('mode', 'not-sent', `${this.mode} mode prohibits setting changes`);
    }
    if (this.pending) return new SessionError('busy', 'not-sent', `transaction ${this.pending.op.id} is still pending`);
    return undefined;
  }

  private settle(pending: Pending, error?: SessionError, value?: unknown): void {
    if (this.pending !== pending) return;
    clearTimeout(pending.timer);
    this.pending = undefined;
    if (pending.writeStarted) {
      this.lastTx = pending.receipt;
      this.txSeq = ackSeqFor(pending.receipt.seq);
    }
    if (error) pending.reject(error);
    else pending.resolve(value);
  }

  private onTimeout(pending: Pending): void {
    if (this.pending !== pending) return;
    if (!pending.writeStarted) {
      // Still queued: withdraw it so it can never be sent late.
      const i = this.dataQueue.findIndex((item) => item.onStart === pending.onStart);
      if (i >= 0) this.dataQueue.splice(i, 1)[0]!.reject(new Error('withdrawn after timeout'));
      this.settle(pending, new SessionError('timeout', 'not-sent', `${pending.op.id}: timed out before transmission`));
      return;
    }
    // Ambiguous: a late reply could not be told apart from a fresh one. Stop the pipeline.
    this.settle(pending, new SessionError('timeout', 'unknown', `${pending.op.id}: no ${pending.match ? 'reply' : 'ACK'} before timeout`));
    this.setState('desynchronized', `${pending.op.id} timed out`);
  }

  // ---- RX ----

  private async runRxLoop(): Promise<void> {
    let reason = 'device closed the stream';
    for (;;) {
      let result;
      try {
        result = await this.channel.read();
      } catch (error) {
        reason = `read failed: ${describe(error)}`;
        break;
      }
      if (result.done) break;
      if (this.closing) continue; // drain until the channel settles the read
      for (const event of this.parser.push(result.value)) {
        if (event.kind === 'error') this.emit({ type: 'parse-error', error: event.error, dropped: event.dropped });
        else this.onFrame(event.frame);
      }
    }
    if (!this.closing) this.fail(reason);
  }

  private onFrame(frame: Frame): void {
    this.emit({ type: 'rx', frame });
    if (frame.type === FrameType.Ack) return this.onAck(frame.seq);
    if (frame.type !== FrameType.DataMdr) {
      // Unknown family: not interpreted and not acknowledged.
      this.emit({ type: 'unhandled-frame', frame });
      return;
    }
    if (this.mode !== 'passive') this.sendAck(ackSeqFor(frame.seq));

    if (this.lastRx && this.lastRx.seq === frame.seq && sameBytes(this.lastRx.payload, frame.payload)) {
      this.emit({ type: 'duplicate', frame });
      return;
    }
    this.lastRx = frame;

    const pending = this.pending;
    if (pending?.match && pending.writeStarted) {
      const result = pending.match(frame.payload);
      if (result.kind === 'match') return this.settle(pending, undefined, { value: result.value, receipt: pending.receipt });
      if (result.kind === 'malformed') {
        return this.settle(pending, new SessionError('malformed', 'replied', `${pending.op.id}: ${result.reason}`));
      }
    }
    this.emit({ type: 'notification', frame });
  }

  private onAck(seq: number): void {
    const pending = this.pending;
    if (pending?.writeStarted) {
      const valid = seq === ackSeqFor(pending.receipt.seq);
      pending.receipt.ack = valid ? 'valid' : 'mismatch';
      if (valid && !pending.match) this.settle(pending, undefined, { receipt: pending.receipt });
      return;
    }
    // A late ACK for a request that already completed on its reply.
    if (this.lastTx && this.lastTx.ack === 'none' && seq === ackSeqFor(this.lastTx.seq)) {
      this.lastTx.ack = 'valid';
      return;
    }
    this.emit({ type: 'stray-ack', seq });
  }

  private sendAck(seq: number): void {
    const frame: Frame = { type: FrameType.Ack, seq, payload: new Uint8Array(0) };
    const epoch = this.epoch;
    this.enqueue(this.ackQueue, encodeFrame(frame), () => this.emit({ type: 'tx', frame, purpose: 'ACK' })).catch(
      (error: unknown) => {
        if (epoch === this.epoch) this.fail(`ACK write failed: ${describe(error)}`);
      },
    );
  }

  // ---- TX: one writer, complete frames only, ACKs first ----

  private enqueue(queue: WriteItem[], bytes: Uint8Array, onStart: () => void): Promise<void> {
    return new Promise((resolve, reject) => {
      queue.push({ bytes, onStart, resolve, reject });
      void this.pump();
    });
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      for (;;) {
        const item = this.ackQueue.shift() ?? this.dataQueue.shift();
        if (!item) return;
        item.onStart?.();
        try {
          await this.channel.write(item.bytes);
          item.resolve();
        } catch (error) {
          item.reject(error);
        }
      }
    } finally {
      this.pumping = false;
    }
  }

  // ---- lifecycle ----

  private setState(state: SessionState, reason?: string): void {
    this._state = state;
    this.emit(reason === undefined ? { type: 'state', state } : { type: 'state', state, reason });
  }

  /** Transport-level failure: close, and report the reason through `closed`. */
  private fail(reason: string): void {
    this.shutdown(reason).catch((error: unknown) =>
      this.emit({ type: 'state', state: this._state, reason: `cleanup after "${reason}" failed: ${describe(error)}` }),
    );
  }

  close(): Promise<void> {
    return this.shutdown('closed by user');
  }

  private shutdown(reason: string): Promise<void> {
    this.closing ??= (async () => {
      this.setState('closing', reason);
      this.epoch++;
      const pending = this.pending;
      if (pending) {
        const outcome: Outcome = pending.writeStarted ? 'unknown' : 'not-sent';
        this.settle(pending, new SessionError('disconnected', outcome, `${pending.op.id}: ${reason}`));
      }
      const dropped = new Error(`session closing: ${reason}`);
      for (const item of this.ackQueue.splice(0)) item.reject(dropped);
      for (const item of this.dataQueue.splice(0)) item.reject(dropped);
      try {
        await this.channel.close();
      } finally {
        await this.rxLoop;
        this.setState('closed', reason);
        this.resolveClosed(reason);
      }
    })();
    return this.closing;
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

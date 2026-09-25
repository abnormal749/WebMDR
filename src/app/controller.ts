// XM5 controller: connection lifecycle and noise-control flow, without DOM.

import { applyEdit, mergeEdits, sameRaw, type NoiseEdit, type NoiseRaw } from '../features/noiseControl';
import { toHex } from '../protocol/codec';
import type { Profile } from '../protocol/profiles';
import { Session, SessionError, type ByteChannel, type Receipt, type SessionEvent, type SessionMode } from '../protocol/session';
import { decodeNoiseNotification, getNoiseOperation, initOperation, isNoiseReply, setNoiseOperation } from '../protocol/v2';

export type Phase =
  | 'idle'          // no open session
  | 'observing'     // passive: receive only
  | 'initializing'  // reviewed init + state read in progress
  | 'ready'         // init reply and a valid, fresh state read received
  | 'failed'        // open, but not protocol-ready; reconnect required
  | 'closing';

export type ChangeResult =
  | { kind: 'confirmed'; target: NoiseRaw; receipt: Receipt }
  /** ACKed, but the fresh read-back differs; the device's report is shown. */
  | { kind: 'mismatch'; target: NoiseRaw; reported: NoiseRaw; receipt: Receipt }
  /** The device may or may not have applied it. */
  | { kind: 'unknown'; target: NoiseRaw; detail: string }
  | { kind: 'not-sent'; detail: string };

export interface NoiseView {
  /** Latest device-reported state; never a local guess. */
  device?: { raw: NoiseRaw; via: 'reply' | 'notification' };
  inFlight?: { target: NoiseRaw; stage: 'awaiting-ack' | 'confirming' };
  /** Latest user edit not yet sent. Replaced, never accumulated as history. */
  queued?: NoiseEdit;
  last?: ChangeResult;
}

export interface ControllerState {
  phase: Phase;
  mode?: SessionMode;
  detail: string;
  noise: NoiseView;
}

export interface ControllerOptions {
  timeoutMs?: number;
  /** Diagnostic lines (frame hex, parse errors). Only collected if the caller wants them. */
  onLog?: (line: string) => void;
}

export class Controller {
  private _state: ControllerState = { phase: 'idle', detail: 'Not connected', noise: {} };
  private readonly listeners = new Set<(s: ControllerState) => void>();
  private session: Session | undefined;
  /** Identifies the current connection; results from older ones are dropped. */
  private connection = 0;
  private work: Promise<void> | undefined;

  constructor(readonly profile: Profile, private readonly options: ControllerOptions = {}) {}

  get state(): ControllerState {
    return this._state;
  }

  /** True only when a user change may be sent now or queued. */
  get canChange(): boolean {
    const s = this._state;
    return s.phase === 'ready' && s.mode === 'control' && s.noise.device !== undefined && this.profile.noiseControl.write !== 'unsupported';
  }

  subscribe(listener: (s: ControllerState) => void): () => void {
    this.listeners.add(listener);
    listener(this._state);
    return () => this.listeners.delete(listener);
  }

  async attach(channel: ByteChannel, mode: SessionMode): Promise<void> {
    if (this.session) throw new Error('already attached; disconnect first');
    const connection = ++this.connection;
    const session = new Session(channel, {
      mode,
      ...(this.options.timeoutMs === undefined ? {} : { timeoutMs: this.options.timeoutMs }),
      onEvent: (e) => this.onSessionEvent(connection, e),
    });
    this.session = session;
    this.set({ phase: mode === 'passive' ? 'observing' : 'initializing', mode, detail: 'Port open', noise: {} });
    void session.closed.then((reason) => this.onClosed(connection, reason));

    if (mode === 'passive') {
      this.set({ detail: 'Passive: listening only; nothing is sent' });
      return;
    }
    this.work = this.initialize(connection, session);
    await this.work;
  }

  private async initialize(connection: number, session: Session): Promise<void> {
    try {
      this.set({ detail: 'Sending V2 initialization' });
      const init = await session.request(initOperation());
      this.log(connection, `init reply: ${toHex(init.value)}`);
      this.set({ detail: 'Reading noise-control state' });
      const { value } = await session.request(getNoiseOperation(this.profile));
      if (connection !== this.connection) return;
      this.set({ phase: 'ready', detail: 'Protocol ready; state read from device', noise: { device: { raw: value, via: 'reply' } } });
    } catch (error) {
      if (connection !== this.connection) return;
      this.set({ phase: 'failed', detail: `Not protocol-ready: ${describe(error)}` });
    } finally {
      if (connection === this.connection) this.work = undefined;
    }
  }

  /** Fresh GET. Ignored while other work is running. */
  async refresh(): Promise<void> {
    const session = this.session;
    if (!session || this._state.phase !== 'ready' || this.work) return;
    const connection = this.connection;
    this.work = (async () => {
      try {
        const { value } = await session.request(getNoiseOperation(this.profile));
        if (connection === this.connection) this.setNoise({ device: { raw: value, via: 'reply' } });
      } catch (error) {
        if (connection === this.connection) this.onFailure(error);
      } finally {
        if (connection === this.connection) this.work = undefined;
      }
    })();
    await this.work;
    void this.drain();
  }

  /**
   * An explicit, committed user change. At most one change is in flight; a
   * later commit replaces the queued edit instead of adding history.
   */
  commit(edit: NoiseEdit): void {
    if (!this.canChange) {
      this.setNoise({ last: { kind: 'not-sent', detail: 'Controls are not enabled for this connection' } });
      return;
    }
    this.setNoise({ queued: mergeEdits(this._state.noise.queued, edit) });
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.work) return;
    const session = this.session;
    const { queued, device } = this._state.noise;
    if (!session || !queued || !device || !this.canChange) return;
    const connection = this.connection;
    // Merge onto the latest device-reported state at send time.
    const target = applyEdit(device.raw, queued);
    this.setNoise({ queued: undefined });

    let op;
    try {
      op = setNoiseOperation(this.profile, target);
    } catch (error) {
      this.setNoise({ last: { kind: 'not-sent', detail: describe(error) } });
      return;
    }

    this.work = (async () => {
      let receipt: Receipt | undefined;
      try {
        this.setNoise({ inFlight: { target, stage: 'awaiting-ack' } });
        receipt = (await session.command(op)).receipt;
        if (connection !== this.connection) return;
        this.setNoise({ inFlight: { target, stage: 'confirming' } });
        const { value } = await session.request(getNoiseOperation(this.profile));
        if (connection !== this.connection) return;
        const last: ChangeResult = sameRaw(value, target)
          ? { kind: 'confirmed', target, receipt }
          : { kind: 'mismatch', target, reported: value, receipt };
        this.setNoise({ device: { raw: value, via: 'reply' }, inFlight: undefined, last });
        // Do not follow a failed confirmation with an obsolete queued edit.
        if (last.kind !== 'confirmed') this.setNoise({ queued: undefined });
      } catch (error) {
        if (connection !== this.connection) return;
        const sent = !(error instanceof SessionError && error.outcome === 'not-sent');
        const detail = receipt ? `ACK received, confirmation failed: ${describe(error)}` : describe(error);
        this.setNoise({
          inFlight: undefined,
          queued: undefined,
          last: sent ? { kind: 'unknown', target, detail } : { kind: 'not-sent', detail },
        });
        this.onFailure(error);
      } finally {
        if (connection === this.connection) this.work = undefined;
      }
    })();
    await this.work;
    void this.drain();
  }

  async disconnect(): Promise<void> {
    const session = this.session;
    if (!session) return;
    this.set({ phase: 'closing', detail: 'Closing' });
    await session.close();
  }

  private onFailure(error: unknown): void {
    if (this.session?.state === 'desynchronized') {
      this.set({ phase: 'failed', detail: `Outcome unknown; reconnect to resynchronize (${describe(error)})` });
    } else {
      this.set({ detail: describe(error) });
    }
  }

  private onClosed(connection: number, reason: string): void {
    if (connection !== this.connection) return;
    const { inFlight, last } = this._state.noise;
    this.session = undefined;
    this.work = undefined;
    // Invalidate device state and drop queued intent; nothing is replayed on reconnect.
    // The outcome record of the last change is kept so the UI can show it was unconfirmed.
    const outcome: ChangeResult | undefined = inFlight
      ? { kind: 'unknown', target: inFlight.target, detail: 'disconnected before confirmation' }
      : last;
    this.set({ phase: 'idle', detail: `Disconnected: ${reason}`, noise: outcome ? { last: outcome } : {} });
  }

  private onSessionEvent(connection: number, e: SessionEvent): void {
    if (connection !== this.connection) return;
    switch (e.type) {
      case 'tx':
        return this.log(connection, `TX ${e.purpose}: type ${e.frame.type} seq ${e.frame.seq} [${toHex(e.frame.payload)}]`);
      case 'rx':
        return this.log(connection, `RX type ${e.frame.type} seq ${e.frame.seq} [${toHex(e.frame.payload)}]`);
      case 'parse-error':
        return this.log(connection, `parse error: ${e.error} (${e.dropped} bytes dropped)`);
      case 'duplicate':
        return this.log(connection, `duplicate seq ${e.frame.seq} ACKed, not applied`);
      case 'stray-ack':
        return this.log(connection, `ACK seq ${e.seq} with nothing outstanding`);
      case 'unhandled-frame':
        return this.log(connection, `frame family ${e.frame.type} not interpreted`);
      case 'state':
        return this.log(connection, `session ${e.state}${e.reason ? `: ${e.reason}` : ''}`);
      case 'notification':
        return this.onNotification(connection, e.frame.payload);
    }
  }

  private onNotification(connection: number, payload: Uint8Array): void {
    const decoded = decodeNoiseNotification(payload, this.profile);
    if (decoded.kind === 'match') {
      // External change (button, other controller): adopt it. Queued edits are
      // partial and will be applied on top of this state, not enforce an old one.
      this.setNoise({ device: { raw: decoded.value, via: 'notification' } });
      return this.log(connection, 'noise notification adopted');
    }
    if (decoded.kind === 'malformed') return this.log(connection, `noise notification rejected: ${decoded.reason}`);
    if (isNoiseReply(payload)) return this.log(connection, 'unrequested 67 reply ignored (not fresh)');
    this.log(connection, `unhandled notification [${toHex(payload)}]`);
  }

  private log(connection: number, line: string): void {
    if (connection === this.connection) this.options.onLog?.(line);
  }

  private set(patch: Partial<ControllerState>): void {
    this._state = { ...this._state, ...patch };
    for (const l of this.listeners) l(this._state);
  }

  private setNoise(patch: { [K in keyof NoiseView]?: NoiseView[K] | undefined }): void {
    const noise: NoiseView = { ...this._state.noise };
    for (const [k, v] of Object.entries(patch) as [keyof NoiseView, unknown][]) {
      if (v === undefined) delete noise[k];
      else (noise as Record<string, unknown>)[k] = v;
    }
    this.set({ noise });
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

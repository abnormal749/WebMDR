import { FrameParser, type Frame } from '../src/protocol/codec';
import type { ByteChannel } from '../src/protocol/session';

type ReadResult = Awaited<ReturnType<ByteChannel['read']>>;

/** In-memory ByteChannel with controllable reads, writes and close. */
export class FakeChannel implements ByteChannel {
  readonly written: Uint8Array[] = [];
  closeCalls = 0;
  closeError: Error | undefined;
  /** Called synchronously inside write(), e.g. to deliver an immediate reply. */
  onWrite: ((bytes: Uint8Array) => void) | undefined;
  /** When set, write() waits for this before resolving. */
  writeGate: Promise<void> | undefined;
  writeError: Error | undefined;

  private readonly chunks: ReadResult[] = [];
  private waiter: ((r: ReadResult) => void) | undefined;
  private failWaiter: ((e: Error) => void) | undefined;
  private closed = false;

  deliver(...chunks: Uint8Array[]): void {
    for (const value of chunks) this.push({ done: false, value });
  }

  /** Device ends the stream (e.g. Bluetooth link lost). */
  end(): void {
    this.push({ done: true });
  }

  failRead(error: Error): void {
    const fail = this.failWaiter;
    this.waiter = this.failWaiter = undefined;
    fail?.(error);
  }

  read(): Promise<ReadResult> {
    const next = this.chunks.shift();
    if (next) return Promise.resolve(next);
    if (this.closed) return Promise.resolve({ done: true });
    return new Promise((resolve, reject) => {
      this.waiter = resolve;
      this.failWaiter = reject;
    });
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (this.closed) throw new Error('fake: closed');
    this.written.push(bytes);
    this.onWrite?.(bytes);
    if (this.writeGate) await this.writeGate;
    if (this.writeError) throw this.writeError;
  }

  async close(): Promise<void> {
    this.closeCalls++;
    this.closed = true;
    this.push({ done: true });
    if (this.closeError) throw this.closeError;
  }

  sentFrames(): Frame[] {
    const parser = new FrameParser();
    return this.written.flatMap((w) => parser.push(w).flatMap((e) => (e.kind === 'frame' ? [e.frame] : [])));
  }

  private push(r: ReadResult): void {
    const waiter = this.waiter;
    if (waiter) {
      this.waiter = this.failWaiter = undefined;
      waiter(r);
    } else {
      this.chunks.push(r);
    }
  }
}

export function gate(): { promise: Promise<void>; open(): void } {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => (open = resolve));
  return { promise, open };
}

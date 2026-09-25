import { describe, expect, it } from 'vitest';
import { XM5, SONY_V2_SERVICE_UUID } from '../src/protocol/profiles';
import { Session, SessionError } from '../src/protocol/session';
import { getNoiseOperation } from '../src/protocol/v2';
import {
  authorizedServicePorts,
  getSerial,
  openSerialChannel,
  requestServicePort,
  type SerialLike,
  type SerialPortLike,
} from '../src/transport/webSerial';
import { fixtures } from './fixtures';

class FakePort implements SerialPortLike {
  readable: ReadableStream<Uint8Array> | null = null;
  writable: WritableStream<Uint8Array> | null = null;
  written: Uint8Array[] = [];
  opens = 0;
  closes = 0;
  openError: Error | undefined;
  closeError: Error | undefined;
  lockedAtClose: boolean[] = [];
  private controller: ReadableStreamDefaultController<Uint8Array> | undefined;

  constructor(private readonly serviceId: string | null = SONY_V2_SERVICE_UUID) {}

  getInfo() {
    return this.serviceId === null ? {} : { bluetoothServiceClassId: this.serviceId };
  }

  async open(): Promise<void> {
    this.opens++;
    if (this.openError) throw this.openError;
    this.readable = new ReadableStream({ start: (c) => void (this.controller = c) });
    this.writable = new WritableStream({ write: (chunk) => void this.written.push(chunk) });
  }

  push(bytes: Uint8Array): void {
    this.controller?.enqueue(bytes);
  }

  async close(): Promise<void> {
    this.closes++;
    this.lockedAtClose = [this.readable!.locked, this.writable!.locked];
    if (this.closeError) throw this.closeError;
  }
}

function fakeSerial(ports: SerialPortLike[]): SerialLike & { requests: unknown[] } {
  const requests: unknown[] = [];
  return {
    requests,
    requestPort: async (options) => {
      requests.push(options);
      return ports[0]!;
    },
    getPorts: async () => ports,
  };
}

describe('port selection', () => {
  it('requests with an exact service filter and allowlist', async () => {
    const serial = fakeSerial([new FakePort()]);
    await requestServicePort(serial, SONY_V2_SERVICE_UUID.toUpperCase());
    expect(serial.requests).toEqual([
      { filters: [{ bluetoothServiceClassId: SONY_V2_SERVICE_UUID }], allowedBluetoothServiceClassIds: [SONY_V2_SERVICE_UUID] },
    ]);
  });

  it('rejects a port whose info does not name the service', async () => {
    await expect(requestServicePort(fakeSerial([new FakePort(null)]), SONY_V2_SERVICE_UUID)).rejects.toThrow();
    await expect(requestServicePort(fakeSerial([new FakePort('96cc203e-5068-46ad-b32d-e316f5e069ba')]), SONY_V2_SERVICE_UUID)).rejects.toThrow();
  });

  it('lists only authorized ports for the service', async () => {
    const good = new FakePort();
    const ports = await authorizedServicePorts(fakeSerial([new FakePort(null), good]), SONY_V2_SERVICE_UUID);
    expect(ports).toEqual([good]);
  });

  it('feature-detects navigator.serial', () => {
    expect(getSerial({} as Navigator)).toBeUndefined();
    const serial = fakeSerial([]);
    expect(getSerial({ serial } as unknown as Navigator)).toBe(serial);
  });
});

describe('channel lifecycle', () => {
  it('opens at 9600, reads and writes binary data', async () => {
    const port = new FakePort();
    const channel = await openSerialChannel(port);
    await channel.write(fixtures.noiseGet);
    expect(port.written).toEqual([fixtures.noiseGet]);
    port.push(fixtures.ack1);
    await expect(channel.read()).resolves.toEqual({ done: false, value: fixtures.ack1 });
    await channel.close();
  });

  it('close settles a pending read, releases both locks, then closes the port once', async () => {
    const port = new FakePort();
    const channel = await openSerialChannel(port);
    const pendingRead = channel.read();
    await Promise.all([channel.close(), channel.close()]);
    await expect(pendingRead).resolves.toMatchObject({ done: true });
    expect(port.lockedAtClose).toEqual([false, false]);
    expect(port.closes).toBe(1);
  });

  it('surfaces a cleanup failure instead of hiding it', async () => {
    const port = new FakePort();
    port.closeError = new Error('port close failed');
    const channel = await openSerialChannel(port);
    await expect(channel.close()).rejects.toThrow('port close failed');
  });

  it('propagates an open failure (e.g. port held by another tab) without retrying', async () => {
    const port = new FakePort();
    port.openError = new DOMException('Failed to open serial port.', 'NetworkError');
    await expect(openSerialChannel(port)).rejects.toThrow('Failed to open serial port.');
    expect(port.opens).toBe(1);
  });

  it('a session over a real stream pair closes during a pending request', async () => {
    const port = new FakePort();
    const session = new Session(await openSerialChannel(port), { mode: 'read-only' });
    const request = session.request(getNoiseOperation(XM5)).catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 0));
    expect(port.written).toEqual([fixtures.noiseGet]);
    await session.close();
    expect(await request).toBeInstanceOf(SessionError);
    expect(session.state).toBe('closed');
    expect(port.closes).toBe(1);
  });
});

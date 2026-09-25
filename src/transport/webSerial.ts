// Web Serial over Bluetooth RFCOMM. Only the members WebMDR uses are typed here.
// The RFCOMM channel (9 in H-001's SDP record) is resolved by the browser and is never configured.

import type { ByteChannel } from '../protocol/session';

export interface SerialPortInfoLike {
  bluetoothServiceClassId?: string | number;
  usbVendorId?: number;
  usbProductId?: number;
}

export interface SerialPortLike {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  /** Logical availability (Chrome 130+ for RFCOMM); not an open session or protocol readiness. */
  readonly connected?: boolean;
  getInfo(): SerialPortInfoLike;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  /** Chrome 103+: revokes this origin's permission and releases the port. */
  forget?(): Promise<void>;
}

export interface SerialLike {
  requestPort(options: {
    filters: { bluetoothServiceClassId: string }[];
    allowedBluetoothServiceClassIds: string[];
  }): Promise<SerialPortLike>;
  getPorts(): Promise<SerialPortLike[]>;
  addEventListener?(type: 'connect' | 'disconnect', listener: (event: Event) => void): void;
}

/** Feature detection; says nothing about a device or platform being tested. */
export function getSerial(nav: Navigator = navigator): SerialLike | undefined {
  return 'serial' in nav ? (nav as unknown as { serial: SerialLike }).serial : undefined;
}

export function matchesService(port: SerialPortLike, serviceUuid: string): boolean {
  const id = port.getInfo().bluetoothServiceClassId;
  return typeof id === 'string' && id.toLowerCase() === serviceUuid.toLowerCase();
}

/** Must be called from a user gesture. Offers only ports exposing one of `serviceUuids`. */
export async function requestServicePort(serial: SerialLike, serviceUuids: readonly string[]): Promise<SerialPortLike> {
  const uuids = serviceUuids.map((u) => u.toLowerCase());
  const port = await serial.requestPort({
    filters: uuids.map((bluetoothServiceClassId) => ({ bluetoothServiceClassId })),
    allowedBluetoothServiceClassIds: uuids,
  });
  if (!uuids.some((u) => matchesService(port, u))) {
    throw new Error(`selected port exposes none of the services ${uuids.join(', ')}`);
  }
  return port;
}

/** Previously authorized ports for these services. Authorization is not availability. */
export async function authorizedServicePorts(serial: SerialLike, serviceUuids: readonly string[]): Promise<SerialPortLike[]> {
  return (await serial.getPorts()).filter((p) => serviceUuids.some((u) => matchesService(p, u)));
}

/** Baud rate is required by the API but has no meaning for RFCOMM; 9600 is what H-001 used. */
export const BAUD_RATE = 9600;

/**
 * Opens the port and owns its single reader and writer. A second tab holding
 * the port makes open() reject; the error is surfaced, never retried.
 */
export async function openSerialChannel(port: SerialPortLike): Promise<ByteChannel> {
  await port.open({ baudRate: BAUD_RATE });
  if (!port.readable || !port.writable) {
    await port.close();
    throw new Error('port opened without readable and writable streams');
  }
  const reader = port.readable.getReader();
  const writer = port.writable.getWriter();
  let closing: Promise<void> | undefined;
  /** Set when a read fails, e.g. "The device has been lost"; the readable stream is then errored. */
  let readFailed = false;

  return {
    read: () =>
      (reader.read() as ReturnType<ByteChannel['read']>).catch((error: unknown) => {
        readFailed = true;
        throw error;
      }),
    write: (bytes) => writer.write(bytes),
    close: () =>
      (closing ??= (async () => {
        const failures: string[] = [];
        const step = async (name: string, action: () => Promise<void>) => {
          try {
            await action();
          } catch (error) {
            failures.push(`${name}: ${describe(error)}`);
          }
        };
        // Cancel settles a pending read with done: true. An errored stream has
        // nothing to cancel (cancel() only returns its stored error), so skip it.
        if (!readFailed) await step('reader.cancel', () => reader.cancel());
        reader.releaseLock();
        await step('writer.abort', () => writer.abort());
        writer.releaseLock();
        // Chrome closes a lost Bluetooth port itself; any error here is reported with its name.
        await step('port.close', () => port.close());
        if (failures.length > 0) throw new Error(`serial cleanup failed (${failures.join('; ')})`);
      })()),
  };
}

export function describe(error: unknown): string {
  if (error instanceof Error) return error.name && error.name !== 'Error' ? `${error.name}: ${error.message}` : error.message;
  return String(error);
}

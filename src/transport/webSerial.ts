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
}

export interface SerialLike {
  requestPort(options: {
    filters: { bluetoothServiceClassId: string }[];
    allowedBluetoothServiceClassIds: string[];
  }): Promise<SerialPortLike>;
  getPorts(): Promise<SerialPortLike[]>;
  addEventListener?(type: 'connect' | 'disconnect', listener: () => void): void;
}

/** Feature detection; says nothing about a device or platform being tested. */
export function getSerial(nav: Navigator = navigator): SerialLike | undefined {
  return 'serial' in nav ? (nav as unknown as { serial: SerialLike }).serial : undefined;
}

export function matchesService(port: SerialPortLike, serviceUuid: string): boolean {
  const id = port.getInfo().bluetoothServiceClassId;
  return typeof id === 'string' && id.toLowerCase() === serviceUuid.toLowerCase();
}

/** Must be called from a user gesture. */
export async function requestServicePort(serial: SerialLike, serviceUuid: string): Promise<SerialPortLike> {
  const uuid = serviceUuid.toLowerCase();
  const port = await serial.requestPort({
    filters: [{ bluetoothServiceClassId: uuid }],
    allowedBluetoothServiceClassIds: [uuid],
  });
  if (!matchesService(port, uuid)) {
    throw new Error(`selected port does not expose service ${uuid}`);
  }
  return port;
}

/** Previously authorized ports for this service. Authorization is not availability. */
export async function authorizedServicePorts(serial: SerialLike, serviceUuid: string): Promise<SerialPortLike[]> {
  return (await serial.getPorts()).filter((p) => matchesService(p, serviceUuid));
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

  return {
    read: () => reader.read() as ReturnType<ByteChannel['read']>,
    write: (bytes) => writer.write(bytes),
    close: () =>
      (closing ??= (async () => {
        const failures: unknown[] = [];
        // Cancel settles a pending read with done: true; then release both locks and close.
        await reader.cancel().catch((e: unknown) => failures.push(e));
        reader.releaseLock();
        await writer.abort().catch((e: unknown) => failures.push(e));
        writer.releaseLock();
        await port.close().catch((e: unknown) => failures.push(e));
        if (failures.length === 1) throw failures[0];
        if (failures.length > 1) throw new AggregateError(failures, 'serial port cleanup failed');
      })()),
  };
}

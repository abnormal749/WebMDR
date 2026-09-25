// DOM binding only. All protocol behaviour lives in src/app, src/protocol and src/transport.

import { Controller, type ChangeResult, type ControllerState } from '../app/controller';
import { modeOf, type NoiseMode, type NoiseRaw } from '../features/noiseControl';
import { XM5 } from '../protocol/profiles';
import type { SessionMode } from '../protocol/session';
import {
  authorizedServicePorts,
  getSerial,
  openSerialChannel,
  requestServicePort,
  type SerialPortLike,
} from '../transport/webSerial';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ui = {
  modeSet: $('mode'),
  optinRow: $('optin-row'),
  optin: $<HTMLInputElement>('optin'),
  choose: $<HTMLButtonElement>('choose'),
  connect: $<HTMLButtonElement>('connect'),
  disconnect: $<HTMLButtonElement>('disconnect'),
  refresh: $<HTMLButtonElement>('refresh'),
  stages: $('stages'),
  detail: $('detail'),
  deviceState: $('device-state'),
  ncMode: $<HTMLFieldSetElement>('nc-mode'),
  ncAmbient: $<HTMLFieldSetElement>('nc-ambient'),
  level: $<HTMLInputElement>('level'),
  levelOut: $<HTMLOutputElement>('level-out'),
  voice: $<HTMLInputElement>('voice'),
  change: $('change'),
  diag: $<HTMLInputElement>('diag'),
  log: $<HTMLPreElement>('log'),
};

const MAX_LOG_LINES = 400;
const logLines: string[] = [];
const serial = getSerial();
const controller = new Controller(XM5, {
  onLog: (line) => {
    if (!ui.diag.checked) return;
    logLines.push(`${new Date().toISOString().slice(11, 23)} ${line}`);
    if (logLines.length > MAX_LOG_LINES) logLines.splice(0, logLines.length - MAX_LOG_LINES);
    ui.log.textContent = logLines.join('\n');
  },
});

let port: SerialPortLike | undefined;
let portOpen = false;
let busy = false;

ui.level.min = String(XM5.noiseControl.levelWrite.min);
ui.level.max = String(XM5.noiseControl.levelWrite.max);

function selectedMode(): SessionMode {
  const value = (document.querySelector('input[name="mode"]:checked') as HTMLInputElement).value;
  // Control requires the explicit opt-in; otherwise fall back to read-only.
  if (value === 'control' && !ui.optin.checked) return 'read-only';
  return value as SessionMode;
}

async function withBusy(task: () => Promise<void>): Promise<void> {
  busy = true;
  render(controller.state);
  try {
    await task();
  } catch (error) {
    ui.detail.textContent = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  } finally {
    busy = false;
    render(controller.state);
  }
}

async function connect(): Promise<void> {
  if (!port) return;
  const channel = await openSerialChannel(port); // a second tab holding the port rejects here; no retry
  portOpen = true;
  try {
    await controller.attach(channel, selectedMode());
  } catch (error) {
    await channel.close();
    portOpen = false;
    throw error;
  }
}

ui.choose.addEventListener('click', () =>
  withBusy(async () => {
    if (!serial) return;
    port = await requestServicePort(serial, XM5.serviceUuid); // user gesture
    await connect();
  }),
);
ui.connect.addEventListener('click', () => withBusy(connect));
ui.disconnect.addEventListener('click', () => withBusy(() => controller.disconnect()));
ui.refresh.addEventListener('click', () => void controller.refresh());
ui.modeSet.addEventListener('change', () => render(controller.state));
ui.optin.addEventListener('change', () => render(controller.state));
ui.diag.addEventListener('change', () => {
  ui.log.hidden = !ui.diag.checked;
  if (!ui.diag.checked) {
    logLines.length = 0;
    ui.log.textContent = '';
  }
});

// Commit only on explicit, completed interactions ('change', not 'input').
ui.ncMode.addEventListener('change', (e) => controller.commit({ mode: (e.target as HTMLInputElement).value as NoiseMode }));
ui.level.addEventListener('input', () => (ui.levelOut.value = ui.level.value));
ui.level.addEventListener('change', () => controller.commit({ level: Number(ui.level.value) }));
ui.voice.addEventListener('change', () => controller.commit({ voice: ui.voice.checked }));

serial?.addEventListener?.('connect', () => render(controller.state));
serial?.addEventListener?.('disconnect', () => render(controller.state));

// ---- rendering ----

const yes = (text: string) => `<span class="yes">${text}</span>`;
const no = (text: string) => `<span class="no">${text}</span>`;

function render(state: ControllerState): void {
  const connected = state.phase !== 'idle';
  ui.optinRow.hidden = (document.querySelector('input[name="mode"]:checked') as HTMLInputElement).value !== 'control';
  for (const input of ui.modeSet.querySelectorAll('input')) input.disabled = connected;
  ui.optin.disabled = connected;
  ui.choose.disabled = !serial || busy || connected;
  ui.connect.disabled = !serial || busy || connected || !port;
  ui.disconnect.disabled = busy || !connected || state.phase === 'closing';
  ui.refresh.disabled = state.phase !== 'ready';

  const available = port?.connected;
  const rows: [string, string][] = [
    ['Web Serial API', serial ? yes('available') : `<span class="bad">not available in this browser</span>`],
    ['Port authorized', port ? yes('yes') : no('no')],
    ['Device available', available === undefined ? no('not reported') : available ? yes('yes') : no('no')],
    ['Port open', portOpen ? yes('yes') : no('no')],
    ['Session mode', state.mode ?? no('—')],
    ['Protocol ready', protocolLabel(state)],
  ];
  ui.stages.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  if (!busy) ui.detail.textContent = state.detail;

  renderNoise(state);
}

function protocolLabel(state: ControllerState): string {
  switch (state.phase) {
    case 'ready': return yes('yes — init reply and valid state read');
    case 'initializing': return '<span class="warn">initializing…</span>';
    case 'observing': return no('not attempted (passive)');
    case 'failed': return '<span class="bad">no — reconnect required</span>';
    default: return no('no');
  }
}

function renderNoise(state: ControllerState): void {
  const { device, inFlight, queued, last } = state.noise;
  const editable = controller.canChange;

  ui.deviceState.textContent = device
    ? `Device reports: ${describeRaw(device.raw)} (${device.via === 'reply' ? 'read reply' : 'notification'})`
    : 'No device state.';

  // Show the device's values unless the user has an edit in progress.
  if (device && !inFlight && !queued) {
    const mode = modeOf(device.raw);
    for (const r of ui.ncMode.querySelectorAll<HTMLInputElement>('input')) r.checked = r.value === mode;
    ui.level.value = String(device.raw.level);
    ui.voice.checked = device.raw.voice === 1;
  }
  // Without device state there is no level to show; the slider position is only a presentation default.
  ui.levelOut.value = device ? ui.level.value : '—';
  ui.ncMode.disabled = !editable;
  ui.ncAmbient.disabled = !editable || !device || modeOf(device.raw) !== 'ambient';

  const lines: string[] = [];
  if (inFlight) {
    lines.push(inFlight.stage === 'awaiting-ack'
      ? `Sending ${describeRaw(inFlight.target)} — waiting for protocol ACK`
      : `ACK received — reading back state to confirm ${describeRaw(inFlight.target)}`);
  }
  if (queued) lines.push('Latest change queued; sent after the current one completes.');
  if (last) lines.push(describeResult(last));
  if (state.mode === 'control' && !editable && state.phase === 'ready') lines.push('Controls disabled.');
  ui.change.textContent = lines.join(' ');
}

function describeRaw(raw: NoiseRaw): string {
  const mode = modeOf(raw);
  const name = mode === 'off' ? 'Off' : mode === 'ambient' ? 'Ambient' : 'Noise cancelling';
  return `${name}, level ${raw.level}${mode === 'ambient' ? '' : ' (inactive)'}, voice focus ${raw.voice ? 'on' : 'off'}`;
}

function describeResult(r: ChangeResult): string {
  switch (r.kind) {
    case 'confirmed': return `Confirmed by device read-back: ${describeRaw(r.target)}.`;
    case 'mismatch': return `ACK received, but the device now reports ${describeRaw(r.reported)} instead of ${describeRaw(r.target)}.`;
    case 'unknown': return `Outcome unknown for ${describeRaw(r.target)}: ${r.detail}.`;
    case 'not-sent': return `Not sent: ${r.detail}.`;
  }
}

// ---- startup (after all module-level bindings are initialized) ----

controller.subscribe((state) => {
  if (state.phase === 'idle') portOpen = false;
  render(state);
});

void (async () => {
  if (!serial) return;
  // Previously authorized ports are offered for a manual connect, never opened automatically.
  const ports = await authorizedServicePorts(serial, XM5.serviceUuid);
  if (ports[0] && !port) {
    port = ports[0];
    render(controller.state);
  }
})();

// DOM binding only. All protocol behaviour lives in src/app, src/protocol and src/transport.

import { Controller, type ChangeResult, type ControllerState } from '../app/controller';
import type { NoiseMode, NoiseState } from '../features/noiseControl';
import { dialectFor } from '../protocol/dialect';
import { PROFILES, profileForService, type Evidence, type Profile } from '../protocol/profiles';
import type { SessionMode } from '../protocol/session';
import {
  authorizedServicePorts,
  getSerial,
  openSerialChannel,
  describe,
  requestServicePort,
  type SerialPortLike,
} from '../transport/webSerial';
import { disconnectOnPageHide } from './lifecycle';

declare const __WEBMDR_BUILD__: string;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ui = {
  modeSet: $('mode'),
  optinRow: $('optin-row'),
  optin: $<HTMLInputElement>('optin'),
  choose: $<HTMLButtonElement>('choose'),
  connect: $<HTMLButtonElement>('connect'),
  disconnect: $<HTMLButtonElement>('disconnect'),
  refresh: $<HTMLButtonElement>('refresh'),
  forget: $<HTMLButtonElement>('forget'),
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
  build: $('build'),
  devices: $('devices'),
};

const MAX_LOG_LINES = 400;
const logLines: string[] = [];
const serial = getSerial();
function diag(line: string): void {
  if (!ui.diag.checked) return;
  if (logLines.length === 0) logLines.push(`WebMDR build ${__WEBMDR_BUILD__} at ${location.origin}; times are UTC`);
  logLines.push(`${new Date().toISOString().slice(11, 23)}Z ${line}`);
  if (logLines.length > MAX_LOG_LINES) logLines.splice(0, logLines.length - MAX_LOG_LINES);
  ui.log.textContent = logLines.join('\n');
}
const controller = new Controller({ onLog: diag });
const SERVICES = PROFILES.map((p) => p.serviceUuid);
const profileOf = (p: SerialPortLike | undefined): Profile | undefined => profileForService(p?.getInfo().bluetoothServiceClassId);

let port: SerialPortLike | undefined;
let portOpen = false;
let busy = false;


function selectedMode(): SessionMode {
  const value = (document.querySelector('input[name="mode"]:checked') as HTMLInputElement).value;
  // Control requires the explicit opt-in; otherwise fall back to read-only.
  if (value === 'control' && !ui.optin.checked) return 'read-only';
  return value as SessionMode;
}

/** Error from the last user action; shown until the next action so render() cannot hide it. */
let actionError: string | undefined;

async function withBusy(task: () => Promise<void>): Promise<void> {
  busy = true;
  actionError = undefined;
  render(controller.state);
  try {
    await task();
  } catch (error) {
    actionError = describe(error) + (openNetworkError ? REOPEN_HINT : '');
  } finally {
    busy = false;
    render(controller.state);
  }
}

// H-005/H-006: after the headset has been switched off and on, Chrome 154 on macOS
// cannot reopen the port until Chrome restarts, whatever the page did beforehand
// (close, forget, re-select). See docs/device-matrix.md.
const REOPEN_HINT =
  ' Known issue: after the headset has been switched off and on, Chrome on macOS cannot reopen it ' +
  'until Chrome restarts. Quit Chrome (⌘Q) and reopen WebMDR.';
let openNetworkError = false;

async function connect(): Promise<void> {
  if (!port) return;
  const profile = profileOf(port);
  if (!profile) throw new Error('The selected port exposes no Sony service that WebMDR knows.');
  openNetworkError = false;
  diag(`opening port (device available: ${port.connected ?? 'not reported'})`);
  let channel;
  try {
    channel = await openSerialChannel(port); // a second tab holding the port rejects here; no retry
  } catch (error) {
    diag(`open failed: ${describe(error)}`);
    openNetworkError = error instanceof Error && error.name === 'NetworkError';
    throw error;
  }
  diag(`port open; protocol ${profile.label} from service ${profile.serviceUuid}`);
  portOpen = true;
  try {
    await controller.attach(channel, selectedMode(), profile);
  } catch (error) {
    await channel.close();
    portOpen = false;
    throw error;
  }
}

ui.choose.addEventListener('click', () =>
  withBusy(async () => {
    if (!serial) return;
    port = await requestServicePort(serial, SERVICES); // user gesture
    await connect();
  }),
);
ui.connect.addEventListener('click', () => withBusy(connect));
ui.disconnect.addEventListener('click', () => withBusy(() => controller.disconnect()));
ui.refresh.addEventListener('click', () => void controller.refresh());
ui.forget.addEventListener('click', () =>
  withBusy(async () => {
    if (!port?.forget) return;
    diag('forgetting port (permission revoked)');
    await port.forget();
    port = undefined;
    openNetworkError = false;
    diag('port forgotten');
  }),
);
ui.modeSet.addEventListener('change', () => render(controller.state));
ui.optin.addEventListener('change', () => render(controller.state));
ui.diag.addEventListener('change', () => {
  ui.log.hidden = !ui.diag.checked;
  if (!ui.diag.checked) {
    logLines.length = 0;
    ui.log.textContent = '';
  }
});

ui.ncMode.addEventListener('change', (e) => controller.commit({ mode: (e.target as HTMLInputElement).value as NoiseMode }));
ui.voice.addEventListener('change', () => controller.commit({ voice: ui.voice.checked }));

// Live level adjustment. H-003 measured 45–119 ms per confirmed change; the
// controller keeps one change in flight plus only the latest pending level, so
// dragging never builds a backlog of obsolete positions.
let lastLevelCommit: number | undefined; // within the current interaction
let draggingLevel = false;
function commitLevel(): void {
  ui.levelOut.value = ui.level.value;
  const level = Number(ui.level.value);
  if (level === lastLevelCommit) return; // 'change' repeats the last 'input' value
  lastLevelCommit = level;
  controller.commit({ level });
}
function endLevelDrag(): void {
  if (!draggingLevel) return;
  draggingLevel = false;
  render(controller.state);
}
ui.level.addEventListener('pointerdown', () => {
  draggingLevel = true;
  lastLevelCommit = undefined;
});
ui.level.addEventListener('input', commitLevel);
ui.level.addEventListener('change', () => {
  commitLevel();
  lastLevelCommit = undefined;
});
window.addEventListener('pointerup', endLevelDrag);
window.addEventListener('pointercancel', endLevelDrag);

disconnectOnPageHide(window, () => controller.disconnect(), (error) => console.error('WebMDR: disconnect on page hide failed', error));

// Logical availability changes (Chrome 130+ for Bluetooth RFCOMM). Reconnect stays manual.
for (const type of ['connect', 'disconnect'] as const) {
  serial?.addEventListener?.(type, (event) => {
    const target = event.target as SerialPortLike | null;
    const which = target === port ? 'selected port' : `other port, service ${String(target?.getInfo?.().bluetoothServiceClassId ?? 'unknown')}`;
    diag(`serial ${type} event: ${which} (available: ${target?.connected ?? 'not reported'})`);
    render(controller.state);
  });
}

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
  ui.forget.disabled = !port?.forget || busy || connected;

  const available = port?.connected;
  const rows: [string, string][] = [
    ['Web Serial API', serial ? yes('available') : `<span class="bad">not available in this browser</span>`],
    ['Port authorized', port ? yes('yes') : no('no')],
    ['Device available', available === undefined ? no('not reported') : available ? yes('yes') : no('no')],
    ['Port open', portOpen ? yes('yes') : no('no')],
    ['Protocol', profileOf(port) ? escapeHtml(profileOf(port)!.label) : no('—')],
    ['Session mode', state.mode ?? no('—')],
    ['Protocol ready', protocolLabel(state)],
  ];
  ui.stages.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  ui.detail.textContent = actionError ?? state.detail;
  ui.detail.classList.toggle('bad', actionError !== undefined);

  renderNoise(state);
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

const EVIDENCE_LABEL: Record<Evidence, string> = {
  'hardware-verified': 'tested in WebMDR',
  'source-reviewed': 'untested (upstream source only)',
  unknown: 'unknown',
  unsupported: 'unsupported',
};

function renderDevices(): void {
  ui.devices.innerHTML = PROFILES.map((p) => {
    const rows = p.models
      .map((m) => `<tr><td>${escapeHtml(m.model)}</td><td class="${m.evidence === 'hardware-verified' ? 'yes' : 'no'}">${EVIDENCE_LABEL[m.evidence]}</td><td>${escapeHtml(m.note)}</td></tr>`)
      .join('');
    return `<h3>${escapeHtml(p.label)} <code>${p.serviceUuid}</code></h3><table><thead><tr><th>Model</th><th>Noise control</th><th>Evidence</th></tr></thead><tbody>${rows}</tbody></table>`;
  }).join('');
}

function protocolLabel(state: ControllerState): string {
  switch (state.phase) {
    case 'ready':
      return yes(state.profile && dialectFor(state.profile).init ? 'yes — init reply and valid state read' : 'yes — valid state read');
    case 'initializing': return '<span class="warn">initializing…</span>';
    case 'observing': return no('not attempted (passive)');
    case 'failed': return '<span class="bad">no — reconnect required</span>';
    default: return no('no');
  }
}

function renderNoise(state: ControllerState): void {
  const { device, inFlight, queued, last } = state.noise;
  const editable = controller.canChange;
  const view = device ? controller.view(device.raw) : undefined;
  const range = state.profile?.noiseControl.levelWrite;
  if (range) {
    ui.level.min = String(range.min);
    ui.level.max = String(range.max);
  }

  ui.deviceState.textContent = view
    ? `Device reports: ${describeState(view)} (${device!.via === 'reply' ? 'read reply' : 'notification'})`
    : 'No device state.';

  // Show the device's values unless the user has an edit in progress.
  if (view && !inFlight && !queued) {
    for (const r of ui.ncMode.querySelectorAll<HTMLInputElement>('input')) r.checked = r.value === view.mode;
    // Never move the thumb under the user's pointer while dragging.
    if (!draggingLevel) ui.level.value = String(view.level);
    ui.voice.checked = view.voice;
  }
  // A level outside the settable range (e.g. V1 reports 0 outside ambient) is not shown as a
  // slider position; the thumb's resting place is only a presentation default.
  ui.levelOut.value = view && range && view.level >= range.min && view.level <= range.max ? ui.level.value : '—';
  ui.build.textContent = __WEBMDR_BUILD__;
  ui.ncMode.disabled = !editable;
  ui.ncAmbient.disabled = !editable || view?.mode !== 'ambient';

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

function describeState(s: NoiseState): string {
  const name = s.mode === 'off' ? 'Off' : s.mode === 'ambient' ? 'Ambient' : 'Noise cancelling';
  return `${name}, level ${s.level}${s.mode === 'ambient' ? '' : ' (inactive)'}, voice passthrough ${s.voice ? 'on' : 'off'}`;
}

function describeRaw(raw: unknown): string {
  const view = controller.view(raw);
  return view ? describeState(view) : 'unknown state';
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

renderDevices();
controller.subscribe((state) => {
  if (state.phase === 'idle') portOpen = false;
  render(state);
});

void (async () => {
  if (!serial) return;
  // Previously authorized ports are offered for a manual connect, never opened automatically.
  const ports = await authorizedServicePorts(serial, SERVICES);
  if (ports[0] && !port) {
    port = ports[0];
    render(controller.state);
  }
})();

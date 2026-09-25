// DOM binding only. All protocol behaviour lives in src/app, src/protocol and src/transport.

import { Controller, type ChangeResult, type ControllerState } from '../app/controller';
import type { NoiseMode, NoiseState } from '../features/noiseControl';
import { dialectFor } from '../protocol/dialect';
import { PROFILES, profileForService, type Profile } from '../protocol/profiles';
import type { SessionMode } from '../protocol/session';
import {
  authorizedServicePorts,
  describe,
  getSerial,
  openSerialChannel,
  requestServicePort,
  type SerialPortLike,
} from '../transport/webSerial';
import { disconnectOnPageHide } from './lifecycle';

declare const __WEBMDR_BUILD__: string;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ui = {
  advanced: $<HTMLInputElement>('advanced'),
  unsupported: $('unsupported'),
  headsetName: $('headset-name'),
  headsetMeta: $('headset-meta'),
  connect: $<HTMLButtonElement>('connect'),
  disconnect: $<HTMLButtonElement>('disconnect'),
  chooseOther: $<HTMLButtonElement>('choose-other'),
  status: $('status'),
  controls: $('controls'),
  optinNotice: $('optin-notice'),
  optinEnable: $<HTMLButtonElement>('optin-enable'),
  ncMode: $<HTMLFieldSetElement>('nc-mode'),
  ncAmbient: $<HTMLFieldSetElement>('nc-ambient'),
  level: $<HTMLInputElement>('level'),
  levelOut: $<HTMLOutputElement>('level-out'),
  voice: $<HTMLInputElement>('voice'),
  change: $('change'),
  advancedPanel: $('advanced-panel'),
  modeSet: $<HTMLFieldSetElement>('mode'),
  stages: $('stages'),
  evidence: $('evidence'),
  deviceState: $('device-state'),
  changeDetail: $('change-detail'),
  refresh: $<HTMLButtonElement>('refresh'),
  forget: $<HTMLButtonElement>('forget'),
  log: $<HTMLPreElement>('log'),
  build: $('build'),
};

// ---- advanced switch (a per-browser convenience; storage may be unavailable) ----

const ADVANCED_KEY = 'webmdr.advanced';
function loadAdvanced(): boolean {
  try {
    return localStorage.getItem(ADVANCED_KEY) === '1';
  } catch {
    return false; // storage blocked: fall back to the simple view
  }
}
function saveAdvanced(on: boolean): void {
  try {
    localStorage.setItem(ADVANCED_KEY, on ? '1' : '0');
  } catch {
    // storage blocked: the switch still works for this page view
  }
}

// ---- diagnostics log ----
// Kept in this page's memory only (bounded, frame bytes, never stored or sent), so that
// turning Advanced on after a problem still shows what happened. Displayed only in Advanced.

const MAX_LOG_LINES = 400;
const LOG_HEADER = `WebMDR build ${__WEBMDR_BUILD__} at ${location.origin}; times are UTC`;
const logLines: string[] = [];
function diag(line: string): void {
  logLines.push(`${new Date().toISOString().slice(11, 23)}Z ${line}`);
  if (logLines.length > MAX_LOG_LINES) logLines.splice(0, logLines.length - MAX_LOG_LINES);
  if (ui.advanced.checked) showLog();
}
function showLog(): void {
  ui.log.textContent = logLines.length ? [LOG_HEADER, ...logLines].join('\n') : '';
}

const serial = getSerial();
const controller = new Controller({ onLog: diag });
const SERVICES = PROFILES.map((p) => p.serviceUuid);
const profileOf = (p: SerialPortLike | undefined): Profile | undefined => profileForService(p?.getInfo().bluetoothServiceClassId);

let port: SerialPortLike | undefined;
let portOpen = false;
let busy = false;
/** Plain-language result of the last button action; kept until the next action. */
let actionMessage: { text: string; bad: boolean } | undefined;
let openNetworkError = false;

// H-005/H-006: after the headphones have been switched off and on, Chrome on macOS
// cannot reopen the port until Chrome restarts, whatever the page did beforehand.
const REOPEN_HINT =
  'Known issue: after the headphones have been switched off and on, Chrome on macOS cannot reconnect ' +
  'until Chrome restarts. Quit Chrome (⌘Q) and open WebMDR again.';

function selectedMode(): SessionMode {
  return ((ui.modeSet.querySelector('input:checked') as HTMLInputElement | null)?.value ?? 'control') as SessionMode;
}

async function withBusy(task: () => Promise<void>): Promise<void> {
  busy = true;
  actionMessage = undefined;
  render(controller.state);
  try {
    await task();
  } catch (error) {
    actionMessage = explain(error);
  } finally {
    busy = false;
    render(controller.state);
  }
}

/** Short, non-technical messages; the exact error stays in the Advanced log. */
function explain(error: unknown): { text: string; bad: boolean } | undefined {
  diag(`action failed: ${describe(error)}`);
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotFoundError') return undefined; // chooser closed without picking
  if (openNetworkError) return { text: `Couldn't connect to the headphones. ${REOPEN_HINT}`, bad: true };
  if (name === 'InvalidStateError') return { text: 'The headphones are already connected in another tab or window.', bad: true };
  return { text: `Something went wrong: ${describe(error)}`, bad: true };
}

async function connect(): Promise<void> {
  if (!port) return;
  const profile = profileOf(port);
  if (!profile) throw new Error('These headphones do not offer a Sony control service that WebMDR knows.');
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

async function choose(): Promise<void> {
  if (!serial) return;
  port = await requestServicePort(serial, SERVICES); // user gesture
  await connect();
}

ui.connect.addEventListener('click', () => withBusy(() => (port ? connect() : choose())));
ui.chooseOther.addEventListener('click', () => withBusy(choose));
ui.disconnect.addEventListener('click', () => withBusy(() => controller.disconnect()));
ui.refresh.addEventListener('click', () => void controller.refresh());
ui.optinEnable.addEventListener('click', () => controller.allowUnverifiedWrites(true));
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
ui.advanced.addEventListener('change', () => {
  saveAdvanced(ui.advanced.checked);
  if (ui.advanced.checked) showLog();
  render(controller.state);
});

ui.ncMode.addEventListener('change', (e) => controller.commit({ mode: (e.target as HTMLInputElement).value as NoiseMode }));
ui.voice.addEventListener('change', () => controller.commit({ voice: ui.voice.checked }));

// Live level adjustment (H-003: 45–119 ms per confirmed change). The controller keeps
// one change in flight plus only the latest pending level, so dragging never builds a backlog.
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

function render(state: ControllerState): void {
  const advanced = ui.advanced.checked;
  const connected = state.phase !== 'idle';
  const profile = state.profile ?? profileOf(port);

  ui.unsupported.hidden = serial !== undefined;
  ui.advancedPanel.hidden = !advanced;

  // Headset card
  ui.headsetName.textContent = connected ? 'Sony headphones' : port ? 'Sony headphones (not connected)' : 'No headphones connected';
  ui.headsetMeta.textContent = headsetMeta(state, connected);
  ui.connect.hidden = connected;
  ui.connect.disabled = !serial || busy;
  ui.connect.textContent = busy && !connected ? 'Connecting…' : port ? 'Reconnect' : 'Connect';
  ui.disconnect.hidden = !connected;
  ui.disconnect.disabled = busy || state.phase === 'closing';
  ui.chooseOther.hidden = connected || !port || !serial;
  const status = statusMessage(state);
  ui.status.textContent = status?.text ?? '';
  ui.status.classList.toggle('bad', status?.bad === true);

  renderControls(state);
  if (advanced) renderAdvanced(state, profile);
  ui.build.textContent = __WEBMDR_BUILD__;
}

function headsetMeta(state: ControllerState, connected: boolean): string {
  if (!connected) return port ? '' : "Turn your headphones on and make sure they're paired with this computer.";
  const fw = state.firmware;
  return fw?.status === 'known' ? `Firmware ${fw.version}` : '';
}

function statusMessage(state: ControllerState): { text: string; bad: boolean } | undefined {
  if (actionMessage) return actionMessage;
  switch (state.phase) {
    case 'initializing':
      return { text: 'Connecting…', bad: false };
    case 'failed':
      return { text: "Couldn't communicate with the headphones. Disconnect and try again.", bad: true };
    case 'observing':
      return { text: 'Listening only (passive mode).', bad: false };
    case 'idle':
      return state.detail.includes('device has been lost') ? { text: 'The headphones disconnected.', bad: false } : undefined;
    default:
      return undefined;
  }
}

function renderControls(state: ControllerState): void {
  const { device, inFlight, queued, last } = state.noise;
  const view = device ? controller.view(device.raw) : undefined;
  ui.controls.hidden = !view;
  if (!view) return;

  const editable = controller.canChange;
  const range = state.profile?.noiseControl.levelWrite;
  if (range) {
    ui.level.min = String(range.min);
    ui.level.max = String(range.max);
  }
  ui.optinNotice.hidden = !(state.phase === 'ready' && state.mode === 'control' && controller.needsOptIn);

  // Show the device's values unless the user has an edit in progress.
  if (!inFlight && !queued) {
    for (const r of ui.ncMode.querySelectorAll<HTMLInputElement>('input')) r.checked = r.value === view.mode;
    // Never move the thumb under the user's pointer while dragging.
    if (!draggingLevel) ui.level.value = String(view.level);
    ui.voice.checked = view.voice;
  }
  // A level outside the settable range (e.g. V1 reports 0 outside ambient) is not a slider position.
  ui.levelOut.value = range && view.level >= range.min && view.level <= range.max ? ui.level.value : '—';
  ui.ncMode.disabled = !editable;
  ui.ncAmbient.hidden = view.mode !== 'ambient';
  ui.ncAmbient.disabled = !editable;

  ui.change.textContent = inFlight || queued ? 'Saving…' : last ? simpleResult(last) : '';
  ui.change.classList.toggle('bad', last?.kind === 'unknown' || last?.kind === 'mismatch');
}

function simpleResult(r: ChangeResult): string {
  switch (r.kind) {
    case 'confirmed': return 'Saved.';
    case 'mismatch': return 'The headphones kept a different setting.';
    case 'unknown': return "Couldn't confirm the change. Disconnect and reconnect.";
    case 'not-sent': return `Not changed: ${r.detail}.`;
  }
}

// ---- advanced panel ----

const yes = (text: string) => `<span class="yes">${text}</span>`;
const no = (text: string) => `<span class="no">${text}</span>`;

function renderAdvanced(state: ControllerState, profile: Profile | undefined): void {
  const connected = state.phase !== 'idle';
  for (const input of ui.modeSet.querySelectorAll('input')) input.disabled = connected;
  ui.refresh.disabled = state.phase !== 'ready';
  ui.forget.disabled = !port?.forget || busy || connected;

  const available = port?.connected;
  const fw = state.firmware;
  const rows: [string, string][] = [
    ['Web Serial API', serial ? yes('available') : '<span class="bad">not available</span>'],
    ['Port authorized', port ? yes('yes') : no('no')],
    ['Device available', available === undefined ? no('not reported') : available ? yes('yes') : no('no')],
    ['Port open', portOpen ? yes('yes') : no('no')],
    ['Protocol', profile ? escapeHtml(`${profile.label} (service ${profile.serviceUuid})`) : no('—')],
    ['Session mode', state.mode ?? no('—')],
    ['Protocol ready', protocolLabel(state)],
    ['Firmware', !fw ? no('—') : fw.status === 'known' ? escapeHtml(fw.version) : fw.status === 'reading' ? no('reading…') : no(`unavailable (${escapeHtml(fw.reason)})`)],
    ['Status', escapeHtml(state.detail)],
  ];
  ui.stages.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');

  if (profile) {
    const tested = profile.models.filter((m) => m.evidence === 'hardware-verified').map((m) => m.model);
    ui.evidence.textContent =
      `Noise control on ${profile.label}: ${profile.noiseControl.write === 'hardware-verified' ? 'tested' : 'untested'} in WebMDR` +
      (tested.length ? ` (on ${tested.join(', ')}).` : '.') +
      ' The model itself cannot be detected: no reviewed command returns it.';
  } else {
    ui.evidence.textContent = '';
  }

  const { device, inFlight, queued, last } = state.noise;
  ui.deviceState.textContent = device
    ? `Device reports: ${describeRaw(device.raw)} (${device.via === 'reply' ? 'read reply' : 'notification'})`
    : '';
  const lines: string[] = [];
  if (inFlight) {
    lines.push(inFlight.stage === 'awaiting-ack'
      ? `Sending ${describeRaw(inFlight.target)}; waiting for protocol ACK.`
      : `ACK received; reading back state to confirm ${describeRaw(inFlight.target)}.`);
  }
  if (queued) lines.push('Latest change queued; sent after the current one completes.');
  if (last) lines.push(detailedResult(last));
  ui.changeDetail.textContent = lines.join(' ');
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

function describeState(s: NoiseState): string {
  const name = s.mode === 'off' ? 'Off' : s.mode === 'ambient' ? 'Ambient' : 'Noise cancelling';
  return `${name}, level ${s.level}${s.mode === 'ambient' ? '' : ' (inactive)'}, voice passthrough ${s.voice ? 'on' : 'off'}`;
}

function describeRaw(raw: unknown): string {
  const view = controller.view(raw);
  return view ? describeState(view) : 'unknown state';
}

function detailedResult(r: ChangeResult): string {
  switch (r.kind) {
    case 'confirmed': return `Confirmed by device read-back: ${describeRaw(r.target)}.`;
    case 'mismatch': return `ACK received, but the device now reports ${describeRaw(r.reported)} instead of ${describeRaw(r.target)}.`;
    case 'unknown': return `Outcome unknown for ${describeRaw(r.target)}: ${r.detail}.`;
    case 'not-sent': return `Not sent: ${r.detail}.`;
  }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

// ---- startup (after all module-level bindings are initialized) ----

ui.advanced.checked = loadAdvanced();
controller.subscribe((state) => {
  if (state.phase === 'idle') portOpen = false;
  render(state);
});

// Visit counter, present only in the owner's deployment (vite.config.ts). An image request:
// the page path plus `?ref=` if given, else the browser's referrer. Nothing about the device.
const counter = document.querySelector<HTMLMetaElement>('meta[name="webmdr-counter"]')?.content;
if (counter) {
  const url = new URL(counter);
  url.searchParams.set('p', location.pathname);
  url.searchParams.set('r', new URLSearchParams(location.search).get('ref') ?? document.referrer);
  document.body.append(Object.assign(new Image(1, 1), { src: url.href, hidden: true, alt: '' }));
}

void (async () => {
  if (!serial) return;
  // Previously authorized headphones are offered for a manual connect, never opened automatically.
  const ports = await authorizedServicePorts(serial, SERVICES);
  if (ports[0] && !port) {
    port = ports[0];
    render(controller.state);
  }
})();

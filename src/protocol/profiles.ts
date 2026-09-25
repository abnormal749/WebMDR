// A small data table, not a registry. Web Serial exposes no device name, so the
// dialect is chosen from the Bluetooth service the selected port exposes, as
// upstream's macOS client does (Client/macos/MacOSBluetoothConnector.mm @ dea3896:
// legacy service -> V1, otherwise the newer service -> V2). The model list is
// informational: it cannot be detected and is never used to pick bytes.

/** Evidence for one direction of one feature. A timeout never produces 'unsupported'. */
export type Evidence = 'unknown' | 'unsupported' | 'source-reviewed' | 'hardware-verified';

export type Dialect = 'sony-v1' | 'sony-v2';

export interface Range {
  min: number;
  max: number;
}

export interface ModelEvidence {
  model: string;
  /** Evidence in WebMDR for noise control on this model over this dialect. */
  evidence: Evidence;
  note: string;
}

export interface Profile {
  dialect: Dialect;
  label: string;
  serviceUuid: string;
  noiseControl: {
    /** Inquiry subtype byte used by the 66/67/68(/69) family. */
    inquiry: number;
    /** Level values accepted from the device. */
    levelRead: Range;
    /** Level values WebMDR will send. */
    levelWrite: Range;
    /** Dialect-level evidence; per-model evidence is in `models`. */
    read: Evidence;
    write: Evidence;
    provenance: string;
  };
  models: ModelEvidence[];
}

const UPSTREAM = 'upstream DeviceProfileRegistry.cpp @ dea3896';

/** Serial HPC service reported by H-001; upstream Client/Constants.h SERVICE_UUID_V2. */
export const SONY_V2_SERVICE_UUID = '956c7b26-d49a-4ba8-b03f-b17d393cb6e2';
/** Legacy service; upstream Client/Constants.h SERVICE_UUID. Not yet seen in WebMDR. */
export const SONY_V1_SERVICE_UUID = '96cc203e-5068-46ad-b32d-e316f5e069ba';

export const SONY_V2: Profile = {
  dialect: 'sony-v2',
  label: 'Sony V2',
  serviceUuid: SONY_V2_SERVICE_UUID,
  noiseControl: {
    inquiry: 0x17,
    levelRead: { min: 0, max: 20 },
    levelWrite: { min: 1, max: 20 },
    read: 'source-reviewed',
    write: 'source-reviewed',
    provenance:
      'Layout: ProtocolV2.cpp @ dea3896 (66/67/68 17; 69 per DeviceEventDispatcher.cpp). ' +
      'Levels 1-20 confirmed on a WH-1000XM5 (H-003, H-004); upstream HeadphonesBridge.mm also uses 20 for V2.',
  },
  models: [
    { model: 'WH-1000XM5', evidence: 'hardware-verified', note: 'H-003 to H-006: all modes, voice passthrough, levels 1-20' },
    { model: 'WH-1000XM6', evidence: 'source-reviewed', note: `listed as V2 in ${UPSTREAM}` },
    { model: 'WF-1000XM4', evidence: 'source-reviewed', note: `listed as V2 in ${UPSTREAM}` },
    { model: 'WF-1000XM5', evidence: 'source-reviewed', note: `listed as V2 in ${UPSTREAM}` },
    { model: 'WF-1000XM6', evidence: 'source-reviewed', note: `listed as V2 in ${UPSTREAM}` },
    { model: 'WH-CH720N', evidence: 'source-reviewed', note: `listed as V2 in ${UPSTREAM}; upstream Constants.h says layouts were verified on it` },
    { model: 'ULT WEAR (WH-ULT900N)', evidence: 'source-reviewed', note: `listed as V2 in ${UPSTREAM}` },
    { model: 'LinkBuds S (WF-LS900N)', evidence: 'source-reviewed', note: `listed as V2 in ${UPSTREAM}` },
    { model: 'WH-1000XM4 (newer units)', evidence: 'source-reviewed', note: 'upstream Constants.h: "newer XM4" units use V2' },
  ],
};

export const SONY_V1: Profile = {
  dialect: 'sony-v1',
  label: 'Sony V1 (legacy)',
  serviceUuid: SONY_V1_SERVICE_UUID,
  noiseControl: {
    inquiry: 0x02,
    levelRead: { min: 0, max: 20 },
    // ProtocolV1::setNoiseControl clamps to 1-20, but upstream's UI caps V1 at 19
    // (HeadphonesBridge.mm maxAmbientLevel); the tighter bound is used until tested.
    levelWrite: { min: 1, max: 19 },
    read: 'source-reviewed',
    write: 'source-reviewed',
    provenance: 'Layout: ProtocolV1.cpp @ dea3896 (66/67/68 02) and its tests; not tested in WebMDR.',
  },
  models: [
    { model: 'WH-1000XM3', evidence: 'source-reviewed', note: `listed as V1 in ${UPSTREAM}` },
    { model: 'WH-1000XM4', evidence: 'source-reviewed', note: `listed as V1 in ${UPSTREAM}; ProtocolV1.cpp notes GETs replayed on firmware 3.0.1` },
  ],
};

export const PROFILES: readonly Profile[] = [SONY_V2, SONY_V1];

/** The profile for the service a selected port exposes, or undefined: unknown is not V1. */
export function profileForService(serviceUuid: string | number | undefined): Profile | undefined {
  if (typeof serviceUuid !== 'string') return undefined;
  const id = serviceUuid.toLowerCase();
  return PROFILES.find((p) => p.serviceUuid === id);
}

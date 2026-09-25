// A small data table, not a registry. Web Serial exposes no device name, so a
// profile is an explicit user hint that a reviewed exchange must then confirm.

/** Evidence for one direction of one feature. A timeout never produces 'unsupported'. */
export type Evidence = 'unknown' | 'unsupported' | 'source-reviewed' | 'hardware-verified';

export interface Range {
  min: number;
  max: number;
}

export interface Profile {
  id: string;
  label: string;
  dialect: 'sony-v2';
  serviceUuid: string;
  noiseControl: {
    /** Inquiry subtype byte used by 66/67/68/69. */
    inquiry: number;
    /** Level values accepted from the device. */
    levelRead: Range;
    /** Level values WebMDR will send. */
    levelWrite: Range;
    read: Evidence;
    write: Evidence;
    provenance: string;
  };
}

/** Serial HPC service reported by H-001; matches upstream Client/Constants.h SERVICE_UUID_V2. */
export const SONY_V2_SERVICE_UUID = '956c7b26-d49a-4ba8-b03f-b17d393cb6e2';

export const XM5: Profile = {
  id: 'wh-1000xm5',
  label: 'Sony WH-1000XM5',
  dialect: 'sony-v2',
  serviceUuid: SONY_V2_SERVICE_UUID,
  noiseControl: {
    inquiry: 0x17,
    levelRead: { min: 0, max: 20 },
    levelWrite: { min: 1, max: 20 },
    read: 'source-reviewed',
    write: 'source-reviewed',
    provenance:
      'Layout: ProtocolV2.cpp @ dea3896 (66/67/68 17). Level 1–20: upstream V1 clamp; V2 setter never sends 0. ' +
      'No XM5 value range has been hardware-verified in WebMDR.',
  },
};

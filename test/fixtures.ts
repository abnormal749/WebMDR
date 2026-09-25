// Wire fixtures. Provenance labels:
//  upstream-derived — byte arrays taken from sony-device-center tests/protocol/FrameCodecTests.cpp @ dea3896
//  synthetic        — hand-computed from docs/technical-review.md §3 and cross-checked with a
//                     separate throwaway script (not the TS codec).
// None of these is a capture from H-001 or any other hardware.

export const hex = (s: string): Uint8Array => Uint8Array.from(s.trim().split(/\s+/), (b) => parseInt(b, 16));

export const fixtures = {
  /** upstream-derived: DataMdr seq 1, payload 66 02 (V1 inquiry). */
  upstreamV1Inquiry: hex('3e 0c 01 00 00 00 02 66 02 77 3c'),
  /** upstream-derived: ACK seq 0, empty payload. */
  upstreamAck0: hex('3e 01 00 00 00 00 00 01 3c'),

  /** synthetic: V2 init request 00 00, seq 0. */
  init: hex('3e 0c 00 00 00 00 02 00 00 0e 3c'),
  /** synthetic: V2 noise GET 66 17, seq 0. */
  noiseGet: hex('3e 0c 00 00 00 00 02 66 17 8b 3c'),
  /** synthetic: noise reply 67 17 01 01 01 00 0c (ambient, level 12), seq 1. */
  noiseReplyAmbient12: hex('3e 0c 01 00 00 00 07 67 17 01 01 01 00 0c a1 3c'),
  /** synthetic: noise SET 68 17 01 01 01 00 0c, seq 1. */
  noiseSetAmbient12: hex('3e 0c 01 00 00 00 07 68 17 01 01 01 00 0c a2 3c'),
  /** synthetic: ACK seq 1. */
  ack1: hex('3e 01 01 00 00 00 00 02 3c'),
  /** synthetic: payload 3c 3d 3e, every payload byte escaped. */
  escapedPayload: hex('3e 0c 00 00 00 00 03 3d 2c 3d 2d 3d 2e c6 3c'),
  /** synthetic: payload 30, checksum 3d is itself escaped. */
  escapedChecksum: hex('3e 0c 00 00 00 00 01 30 3d 2d 3c'),
  /** synthetic: 69 17 notification, NC with voice focus, level 5. */
  notifyNcVoice5: hex('3e 0c 00 00 00 00 07 69 17 01 00 00 01 05 9a 3c'),
};

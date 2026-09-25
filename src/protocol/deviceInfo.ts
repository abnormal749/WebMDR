// Firmware version query, identical in both dialects:
//   04 02 -> 05 02 <length> <ASCII version>
// Sources: ProtocolV1.cpp and ProtocolV2.cpp getFirmwareVersion @ dea3896 (upstream
// comment "RET 05 02 <len> <ascii version...>"); Gadgetbridge documents the same
// bytes (protocol facts only; no code used). Not yet observed on hardware in WebMDR.
//
// There is no reviewed query for the model name, so the model is not detected.

import type { Dialect } from './profiles';
import type { Match, RequestOperation } from './session';

const SOURCE = 'marconvcm/sony-device-center ProtocolV1.cpp / ProtocolV2.cpp getFirmwareVersion @ dea38969b501a4a167f330dff104414531e80eae';

export function firmwareOperation(dialect: Dialect): RequestOperation<string> {
  return {
    id: `${dialect === 'sony-v1' ? 'v1' : 'v2'}.firmware.get`,
    kind: 'get',
    purpose: 'Read firmware version',
    source: SOURCE,
    dialect,
    payload: Uint8Array.of(0x04, 0x02),
    optional: true,
    match: (p): Match<string> => {
      if (p[0] !== 0x05 || p[1] !== 0x02) return { kind: 'no-match' };
      const length = p[2];
      if (length === undefined || p.length !== 3 + length) {
        return { kind: 'malformed', reason: `length byte ${length} does not match ${p.length - 3} version bytes` };
      }
      const text = p.subarray(3);
      if (length === 0 || !text.every((b) => b >= 0x20 && b <= 0x7e)) return { kind: 'malformed', reason: 'version is not printable ASCII' };
      return { kind: 'match', value: String.fromCharCode(...text) };
    },
  };
}

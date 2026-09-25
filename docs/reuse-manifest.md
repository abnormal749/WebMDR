# Reuse manifest

Every file in WebMDR that imports or closely translates third-party material is listed here. Notices ship in `THIRD_PARTY_NOTICES.txt` (copied into the build) and in a `/*! */` header that the bundle preserves.

WebMDR is MIT-licensed ([LICENSE](../LICENSE)). The entries below also remain under their upstream MIT terms, whose notice must be kept.

## Sony Device Center

Repository `marconvcm/sony-device-center`, commit `dea38969b501a4a167f330dff104414531e80eae`, MIT License.

| Local destination | Upstream source | Relationship | Modifications |
| --- | --- | --- | --- |
| `src/protocol/codec.ts` | `libs/sony-protocol/src/FrameCodec.cpp`, `include/sony/protocol/FrameCodec.h`, `DataType.h` | Close translation of frame layout, escape table, checksum, 2048-byte bound and frame-family values | Streaming byte parser instead of whole-frame decode; exact decoded length `6 + length + 1` (upstream accepts trailing bytes); declared length rejected as soon as the header is read; bounded preallocated buffer; resync on the next start marker; only ACK and DataMdr families named |
| `src/protocol/v2.ts` | `libs/sony-protocol/src/ProtocolV2.cpp` (`initDevice`, `getNoiseControl`, `setNoiseControl`), `DeviceEventDispatcher.cpp` (0x69 notification) | Payload layouts only | Exact 7-byte reply schema, enum and range validation; init exception is not ignored; setter refuses values outside the profile range instead of substituting `1`; no battery or other operations |
| `test/fixtures.ts` (`upstreamV1Inquiry`, `upstreamAck0`) | `tests/protocol/FrameCodecTests.cpp` | Two byte arrays copied | Labelled `upstream-derived` |
| `src/protocol/v1.ts` | `libs/sony-protocol/src/ProtocolV1.cpp` (`getNoiseControl`, `setNoiseControl`), `Client/Constants.h` (NC/ASM enums) | Payload layouts and setter byte choices | Exact 8-byte reply schema with enum and range checks; setter refuses combinations upstream never sends; write range 1-19 per `Client/macos/HeadphonesBridge.mm` rather than the encoder's 1-20; confirmation compares meaning because upstream's own fixtures reply with a different setting-type byte; no battery, EQ or other operations |
| `test/v1.test.ts` (payloads marked "upstream") | `tests/protocol/ProtocolV1Tests.cpp` | Reply and setter byte arrays copied | Labelled upstream-derived; the framed setter fixture is synthetic |
| `src/protocol/profiles.ts` | `libs/sony-protocol/src/DeviceProfileRegistry.cpp` (model/protocol list), `Client/macos/MacOSBluetoothConnector.mm` (dialect chosen by service record), `Client/Constants.h` (service UUIDs; "newer XM4" note) | Facts only | Models are informational with per-model evidence; the dialect comes from the selected port's service UUID, never from a name; capability flags are not imported |

Reviewed but **not** translated: `SonyProtocolSession.cpp` (buffered-reply reuse, unvalidated ACKs; see technical review §2), `CapabilityDiscovery.cpp` (query-sweep probing) and the name-based identification in `DeviceProfileRegistry.cpp`. `src/protocol/session.ts` is an independent design; it relies only on two dialect facts from the session source (host ACK sequence `1 - (seq & 1)`, device ACK sequence adopted as the next TX sequence), noted in its header.

| `src/protocol/deviceInfo.ts` | `libs/sony-protocol/src/ProtocolV1.cpp`, `ProtocolV2.cpp` (`getFirmwareVersion`) | Request bytes and reply layout (`04 02 -> 05 02 <len> <ASCII>`) | Exact length and printable-ASCII checks; marked optional so an unanswered reply ends only this request |

No Gadgetbridge (AGPLv3) code or text is used. Its V1/V2 Sony implementations were read on 2026-09-25 for protocol facts only: they confirm the firmware query bytes, contain no model-name query, and select noise-control subtype `0x15` or `0x17` per device (WebMDR uses `0x17`, verified on the XM5).

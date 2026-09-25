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

Reviewed but **not** translated: `SonyProtocolSession.cpp` (buffered-reply reuse, unvalidated ACKs; see technical review §2) and `CapabilityDiscovery.cpp` / `DeviceProfileRegistry.cpp` (name-based identification). `src/protocol/session.ts` is an independent design; it relies only on two dialect facts from the session source (host ACK sequence `1 - (seq & 1)`, device ACK sequence adopted as the next TX sequence), noted in its header.

No Gadgetbridge (AGPLv3) material is used.

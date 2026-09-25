# Technical review — 2026-09-25

## Scope and method

This review combines H-001 (the user's transport result), direct inspection of Sony Device Center at commit `dea38969b501a4a167f330dff104414531e80eae`, and primary browser documentation. Source links and licensing boundaries are in [sources.md](sources.md).

Findings about upstream control flow are **static-review observations**, not reproduced hardware failures. Proposed fixes below are WebMDR design decisions, not claims about Sony's official specification.

## 1. Correct the evidence

The audited [`Client/Constants.h`](https://github.com/marconvcm/sony-device-center/blob/dea38969b501a4a167f330dff104414531e80eae/Client/Constants.h) already uses the UUID that H-001 opened:

```text
Newer/HPC: 956C7B26-D49A-4BA8-B03F-B17D393CB6E2
Legacy:    96CC203E-5068-46AD-B32D-E316F5E069BA
```

The README's different constants do not establish that both are usable variants. Retain only source-backed endpoint candidates; add variants only when new evidence warrants them. Service discovery and protocol identification are related but distinct: an endpoint hint is not a complete feature description.

The earlier assertion that an empty `getInfo()` object was a JSON-serialization problem was unsupported. Its public dictionary contains optional USB IDs and a Bluetooth service UUID, not a model name or Bluetooth address. Selecting an unrelated generic serial port did not establish Sony discovery.

H-001 establishes transport access only. Treat protocol readiness, command confirmation, sustained audio operation and a published-site test as separate milestones.

## 2. Reuse narrowly, not mechanically

The native project already separates protocol, transport and application layers. WebMDR can use its protocol code as a reference without inheriting the desktop GUI or build system.

Useful initial inputs are the codec, V2 noise-control payload layout and selected test scenarios. Pin their revision. A future upstream documentation correction can be developed in a separate fork; this does not require making that fork the browser project's foundation.

### Session freshness

In [`SonyProtocolSession.cpp`](https://github.com/marconvcm/sony-device-center/blob/dea38969b501a4a167f330dff104414531e80eae/libs/sony-protocol/src/SonyProtocolSession.cpp), `sendAndAwaitResponse()` searches previously unmatched frames before writing the new request. A matching old opcode/subtype can therefore populate the pending response. This is unsuitable as proof of a fresh readback.

The ACK handler also sets the acknowledgement flag without comparing it against the stored expected sequence. The code keeps expected-sequence fields, but their presence alone is not validation. Audit actual sequence behavior before adapting it.

WebMDR should register a response matcher immediately before transmission, reject frames already received before that transaction, and track the connection epoch. A local epoch cannot distinguish two otherwise identical delayed replies within the same live connection. After an ambiguous timeout, the initial implementation should stop the command pipeline and require a clean reconnect/resynchronization rather than blindly issuing the same request again.

### Initialization and capabilities

[`ProtocolV2::initDevice()`](https://github.com/marconvcm/sony-device-center/blob/dea38969b501a4a167f330dff104414531e80eae/libs/sony-protocol/src/ProtocolV2.cpp) ignores an initialization exception. WebMDR must not equate that function returning with successful initialization. Initially require the reviewed XM5 exchange and a valid current-state reply before enabling writes. Any future relaxed rule needs model-specific evidence.

[`CapabilityDiscovery.cpp`](https://github.com/marconvcm/sony-device-center/blob/dea38969b501a4a167f330dff104414531e80eae/libs/sony-protocol/src/CapabilityDiscovery.cpp) returns static capabilities for known names; its fallback treats a successful noise-control query as evidence for ANC, Ambient and voice focus together. Neither proves each feature's writable behavior. Use explicit evidence and separate read/write status.

## 3. Frame contract

The audited [`FrameCodec.cpp`](https://github.com/marconvcm/sony-device-center/blob/dea38969b501a4a167f330dff104414531e80eae/libs/sony-protocol/src/FrameCodec.cpp) defines:

```text
3e | escape(type:u8, seq:u8, payloadLength:u32be, payload, checksum:u8) | 3c
```

The length counts unescaped payload bytes. The checksum is the low eight bits of the sum of unescaped type, sequence, four length bytes and payload; it is not a CRC. Delimiters and the checksum itself are excluded from that sum.

```text
3c → 3d 2c
3d → 3d 2d
3e → 3d 2e
```

The upstream decoder accepts a body that is at least the declared length. For WebMDR's known frame format, require exact decoded length `6 + payloadLength + 1`, valid checksum and valid escape pairs. Bound encoded input and decoded payload before allocating. Unknown frame families must not be interpreted as known commands.

Use independently sourced byte fixtures, not just `decode(encode(x))`. Tests generated by one faulty codec can agree with each other. A captured fixture must be labelled captured only when there is an actual trace and recorded context.

## 4. Session scheduling

Two different forms of serialization are necessary:

```text
Application operations: one outstanding transaction
                              ↓
Serialized frame writer ← protocol ACKs (priority between complete writes)
                              ↑
                       continuous RX loop
```

Do not put an ACK behind a transaction that is waiting for a device response. That creates a potential circular wait. Never interleave bytes from separate frames; priority applies between complete writes, not inside one.

Maintain independent TX sequencing, RX duplicate detection, pending matcher and connection epoch. Derive expected ACK semantics from the audited dialect; do not assume an ACK echoes the transmitted sequence. Replies may arrive very quickly, so register state before the write can trigger RX.

A successful write only shows local submission. An ACK shows protocol receipt according to the protocol's rules. Neither alone proves the user-visible setting. Use a fresh state reply or an appropriate notification to confirm it. For an ambiguous setter timeout, report an unknown outcome; do not automatically repeat a toggle.

Required tests include response-before-ACK, ACK-before-response, duplicate data needing another ACK, wrong subtype, unsolicited notification, stale pre-request response, read failure, and completion arriving after disconnect.

## 5. Noise control is a combined state

The audited V2 implementation uses these payload shapes:

| Operation | Payload / expected reply |
| --- | --- |
| Initialization | `00 00` → reply opcode `01` |
| Noise state | `66 17` → `67 17 01 effect settingType voice level` |
| Noise setting | `68 17 01 effect settingType voice level` |

These are **source-derived protocol layouts, not WebMDR hardware-verified packets**. Use the surrounding frame/session machinery; do not paste isolated payloads into a UI handler.

Because a setter includes several fields, independently sending a level and a voice-focus update can overwrite the other field using stale state. Merge edits into one intent object, keep a revision, and serialize the complete intended state only when it is ready to send.

Keep confirmed device state separate from pending user intent. Preserve untouched fields and retain raw values where the presentation hides inactive settings. Do not substitute a default simply because ANC is active and the Ambient slider is hidden.

Initially commit on interaction completion. For later live dragging, retain one in-flight change and one latest pending intent instead of a fixed-rate backlog. Adopt external state changes when no user intent is pending; never fight the headset's physical button by continuously reapplying an old preference.

## 6. Device expansion without speculative complexity

Start with XM5, then another available V2 device, then a V1 device. This tests both shared behavior and a real protocol boundary before building generalized infrastructure.

The audited V1 source identifies `0x22` as power-off, whereas V2 uses it for battery queries. Therefore a seemingly read-only command is not safe across unknown dialects. Do not select V1 merely because a device is unknown or run a broad query sweep as detection.

Track feature status as unknown / supported / unsupported, with independent read and write evidence. Store inquiry subtype and value constraints where applicable; “V2” does not by itself prove every model uses every feature layout. A timeout is inconclusive, not a negative capability declaration.

The native registry identifies models from names, but Web Serial's `SerialPortInfo` does not provide such a name. Begin with the known XM5 context or an explicit profile hint, then validate a reviewed exchange. Add automatic metadata identification only when its query and response schema are established. Do not cache settings under the shared service UUID as though it identified one headset.

## 7. Browser lifecycle, hosting and trust

Chrome 138 release notes explicitly add Android Bluetooth RFCOMM Web Serial. Keep Android eligible for later tests instead of excluding it. API availability and WebMDR device compatibility remain separate claims.

`SerialPort.connected` describes logical device availability, not an open RFCOMM session or a completed Sony handshake. Avoid automatic reconnects that undo a user's intentional disconnect. The first release should use explicit reconnect and discard old pending intents.

On shutdown, stop new application work, cancel and settle the read loop, release reader/writer locks, then close. Do not wait forever for incoming bytes before releasing the reader. Clean close/reopen is an early milestone, not late polish.

The Chromium interface exposes Serial to windows and dedicated workers, not service workers; requesting a new port is window-only. A PWA is not a replacement for a native background Bluetooth service. A worker may later isolate protocol processing from UI work, but it is unnecessary for the first small interface.

GitHub Pages provides the required HTTPS hosting option. Test the real published origin and build base path, not just localhost. Keep code dependencies bundled, use a production CSP compatible with the built app, and treat script changes as changes to software with access to authorized hardware. No telemetry or automatic trace upload is needed.

## 8. Shorter documents, measurable next work

Root README explains the product and actual status. Root AGENTS defines coding contracts. This review and the evidence record carry detailed rationale, so agents do not repeatedly ingest duplicated roadmaps.

The next useful result is one valid current-state reply, followed by one confirmed setting change—not another round of transport speculation or a large empty compatibility table. Passive RX logging can run briefly alongside this work; silence alone is not failure because the audited V2 path sends a host initialization request.

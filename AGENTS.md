# AGENTS.md — WebMDR

## Mission and current task

Build a static browser-only Sony controller. Use TypeScript; keep the DOM separate from protocol code. Do not introduce a backend, native helper, desktop runtime or firmware updater.

Current milestone: **a tested frame codec and a read-only XM5 session**, then one explicitly requested setting change. Do not build a universal-device framework first.

This snapshot contains documentation, not an implemented application. Inspect the actual repository before assuming files or scripts exist. When scaffolding, add test, type-check and build scripts; run them and report their real results.

## Evidence to preserve

- User reported WH-1000XM5, firmware `2.5.1`, macOS + desktop Chrome, 2026-09-25.
- Discovery and `port.open({ baudRate: 9600 })` passed; streams were available.
- Service UUID: `956c7b26-d49a-4ba8-b03f-b17d393cb6e2` (`Serial HPC`).
- No Sony transaction, setting change or Pages deployment has yet been validated in WebMDR.
- Browser and OS version numbers were not recorded. Do not invent them.
- Channel `9` was an SDP observation, not a browser configuration constant.

Read [the evidence record](docs/device-matrix.md), [technical review](docs/technical-review.md), and [source inventory](docs/sources.md) before protocol work. The former bad UUID is a documentation/code discrepancy, not a required compatibility fallback.

## Reuse policy

Use the pinned Sony Device Center commit in the source inventory. Start with framing, narrow command layouts and relevant fixtures. Do not mechanically copy its transaction/session or capability discovery logic.

For each imported or closely translated file, record repository, commit, source path, local destination, modifications and license. Preserve required notices in source and deployed output. Do not assume Gadgetbridge's AGPLv3 material is MIT because another reference project uses MIT.

Do not open upstream issues, submit changes, create repositories or publish a release unless requested. A local implementation or documentation change does not authorize those actions.

## Minimal architecture

Keep transport, framing, session and feature encoding separate from the UI. Prefer a small data table over a service-registry framework. Add generation-specific modules when they have real use and tests; do not duplicate shared framing.

A protocol adapter must not depend on a Bluetooth name or MAC being exposed by Web Serial. UUIDs are service identifiers, not unique device identities. Unknown profile/capability is not equivalent to a V1 device or an unsupported feature.

## Protocol contract

1. Every outbound operation has a purpose, source, dialect and byte-level test. No unexplained packets in UI code.
2. Read-only mode permits reviewed initialization, GETs and required ACKs; it prohibits setting changes. Passive mode sends nothing.
3. Never try V2 battery opcode `0x22` as a universal probe; the audited V1 source identifies it as power-off.
4. A successful open or ignored initialization exception must not enable controls. Validate the expected exchange and feature state first.
5. Match replies by frame family, opcode, subtype and payload schema. Do not reuse a pre-request buffered reply as a fresh result.
6. Permit one application transaction at a time. Register the pending matcher before its frame is written.
7. Keep byte writes serialized, but allow ACKs to bypass the application transaction queue. The RX loop must not wait for a transaction that itself needs RX.
8. Keep TX sequence, RX duplicate state and connection epoch separate. Validate ACK semantics from the audited dialect; do not assume ACK sequence simply echoes TX sequence.
9. Acknowledge valid duplicate data when required, but do not apply the same notification twice.
10. On ambiguous timeout, do not immediately retry an indistinguishable request or setter. Mark the outcome unknown; reset/resynchronize as documented in the review.
11. On disconnect, reject pending work, invalidate stale state and clear queued intents. Never replay old preferences automatically on reconnect.
12. Keep browser-write completion, protocol receipt and device-confirmed state separate in code and UI.

## Framing and parser

Use binary `Uint8Array` data; no text decoder for the wire protocol. Follow the source-backed frame format in the review.

Bound encoded buffers and decoded lengths before allocation. Reject invalid escapes, checksum failures and mismatched lengths. Recover at a valid frame boundary; do not allow corrupt input to grow memory indefinitely.

Tests must cover every split point of an independent fixture, several frames in one chunk, escape-boundary splits, garbage, truncation, oversized lengths and recovery. Encode/decode round trips alone are insufficient: both functions can share the same mistake.

## Noise-control state

The audited V2 setter carries mode, voice focus and level together. Merge user changes into a validated state and preserve untouched fields. Keep raw device values distinct from presentation defaults when a field is inactive.

Initially send only a committed slider change. Later, permit at most one in-flight change and one latest pending intent; do not queue a long history of obsolete positions. Sending the final intent remains conditional on a healthy session and explicit user action.

A physical button or another controller may change state. With no pending intent, adopt the device's new state. Do not repeatedly enforce a stored preference against it. On failed confirmation, show uncertainty rather than inventing success or blindly toggling again.

Validate per-profile ranges and enum values. A source-reviewed feature can be tried in an explicitly opted-in hardware test before it is marked verified; never turn that experimental status into a public support claim.

## Browser lifecycle and deployment

Request initial permission in a user gesture using an exact service filter and allowlist. Validate the selected port information. Previously authorized, logically available, open and protocol-ready are different states.

Own one reader and one writer. On close, stop new transactions, cancel/settle the read loop, release stream locks and close the port. Test closing during a pending read or request. Do not use an empty catch to hide cleanup failures.

Prefer manual reconnect initially. Handle a second tab's attempted connection without retry loops; same-origin coordination may be added when needed. Installing a PWA does not create a background Bluetooth daemon.

Use feature detection. Desktop Chrome is the tested platform family; Android Chrome 138+ is a documented API candidate, not yet a WebMDR-tested platform.

Keep runtime scripts local to the build, diagnostics opt-in, and personal identifiers out of fixtures. Add a suitable production content-security policy. Test the correct Pages base path and the actual HTTPS deployment separately from localhost.

## Tests and completion report

Use fake transport and fake time for CI; do not require hardware. Include synchronous/early replies, ACK/reply ordering, stale replies, duplicate frames, unrelated notifications, wrong subtypes, disconnect and late completion from an old session.

Record fixtures as captured, upstream-derived or synthetic. Record hardware reports separately with model, firmware, platform, build and exact feature result. Do not equate compilation or unit tests with hardware validation.

After a change, report changed behavior, commands actually run, results, remaining unknowns and the next unmet acceptance criterion. Do not repeat the full roadmap. No release is complete merely because a button appears or `writer.write()` resolves.

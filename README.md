# WebMDR

**Sony headphone controls in your browser.**

WebMDR is a browser-only controller under development. Its first target is Ambient Sound and noise-control settings on the Sony WH-1000XM5. The intended deployment is a static GitHub Pages site using Web Serial over Bluetooth Classic RFCOMM, without an application backend or native helper.

Independent project; not affiliated with or endorsed by Sony. **WebMDR is a working name**, not a claim of trademark or package-name clearance.

## Status — 2026-09-25

A first implementation exists: frame codec, session, V2 noise-control operations, a Web Serial transport and a minimal UI, covered by unit tests with a fake transport. One hardware result exists so far: an ambient level change on the XM5 ([H-002](docs/device-matrix.md)). Other features remain untested on hardware; do not infer support from the code or the tests.

A user-operated prototype on macOS + desktop Chrome successfully selected and opened the WH-1000XM5 control service. Headset firmware was `2.5.1`. Exact browser and macOS versions were not recorded.

| Milestone | Evidence |
| --- | --- |
| Filtered service selection | User reported the expected Bluetooth service UUID |
| RFCOMM open | User reported successful `port.open({ baudRate: 9600 })` |
| Streams available | User reported both `readable` and `writable` |
| Frame codec, session, noise-control flow | Unit tests with fake transport and time (no hardware) |
| Sony protocol exchange / state read | Implied by H-002 (controls enable only after init and a valid state reply) |
| Setting changes / confirmation | Ambient level change user-reported working on XM5 (H-002); mode switching and voice focus not yet reported |
| Audio coexistence / reconnect / multipoint | Not yet tested in WebMDR |
| GitHub Pages deployment | Build and manual-only deploy workflow exist; not yet deployed or tested |

See the sanitized [hardware evidence record](docs/device-matrix.md). Opening streams proves transport access, not that a Sony command has succeeded.

## Transport

```text
Static HTTPS page → browser Web Serial → Bluetooth RFCOMM → Sony control service
```

Use **both** `filters` and `allowedBluetoothServiceClassIds` when requesting the custom service. Permission must be requested from a user action. [Browser references](docs/sources.md#browser-and-hosting).

| Service candidate | UUID | Evidence |
| --- | --- | --- |
| Sony newer-generation / HPC | `956c7b26-d49a-4ba8-b03f-b17d393cb6e2` | XM5 service selection/open reported; matches upstream code |
| Sony legacy | `96cc203e-5068-46ad-b32d-e316f5e069ba` | Upstream code only; not yet tested in WebMDR |

The XM5 SDP record called the first service `Serial HPC` and reported RFCOMM channel `9`. **Do not hard-code that channel:** the browser resolves the selected service.

Earlier drafts used a different UUID from upstream README prose. The audited `Client/Constants.h` already contains the working UUID above. This is a documentation/code discrepancy, **not evidence of firmware-specific UUID variants**. Do not add the erroneous UUID as a fallback. [Audit](docs/technical-review.md#1-correct-the-evidence).

## Browser targets

Desktop Chrome remains the initial target because that is where the transport test passed. Other desktop platforms require their own device tests.

Chrome's release notes document Bluetooth RFCOMM Web Serial on **Android from Chrome 138**. Android is therefore an experimental candidate, not categorically excluded. No Android hardware validation is claimed here. Safari, Firefox and iOS are outside the initial supported target; detect the actual API rather than assuming support from a browser label. [Sources](docs/sources.md#browser-and-hosting).

Treat these states separately: authorized port, device available, RFCOMM open, protocol ready, and feature state confirmed. `SerialPort.connected`, where available, is not a protocol-readiness indicator.

## First useful release

The initial release should establish a session, read the headset's current noise-control state, switch ANC / Ambient / Off, and adjust the XM5's Ambient level. Focus on Voice follows only when its encoding and interaction with levels are checked.

Start by transmitting a slider change when the user commits it, not on every pointer movement. Live adjustment can follow once transaction timing is measured.

There is no early requirement for EQ, DSEE, accounts, telemetry, firmware updates, a PWA service worker, or support for every model listed upstream.

## Design

Start with a small TypeScript implementation and a fake transport for tests:

```text
UI / user intent
      ↓
Noise-control state + V2 command encoding
      ↓
Session: transactions, ACKs, freshness, disconnects
      ↓
Frame codec / streaming parser
      ↓
Web Serial transport
```

These are responsibility boundaries, not a requirement to create a class or framework for each box. A few modules are sufficient. Keep the protocol independent of the DOM so it can be tested without a browser or headset.

Three rules matter most:

- A resolved browser write, a Sony ACK, and a confirmed setting are different outcomes.
- Allow one application transaction at a time, but let protocol ACKs pass independently through a serialized byte writer.
- Noise mode, Ambient level and voice focus form one coherent state. Preserve fields the user did not change.

The [technical review](docs/technical-review.md) defines freshness, timeout and parser rules. The [agent instructions](AGENTS.md) describe how to implement them.

## Expanding to other Sony devices

Build the working XM5 path first. Next, validate another available V2 device; then add a V1 device to test the abstraction. A native application's compatibility table is useful evidence, not a WebMDR support list.

Use a small profile table with explicit provenance, per-feature read/write status, inquiry subtype and value range. Distinguish `unknown`, `unsupported` and `supported`; a timeout means the answer is unknown. Do not infer every writable feature from one successful query.

Web Serial's public port information has no Bluetooth name, MAC address or model field. Do not port a native name-based detector unchanged. Use a reviewed identification exchange where available; an explicit model selection may serve as an initial hint, not proof. Never key device state by service UUID alone: multiple devices can share it. [Browser interface](docs/sources.md#browser-and-hosting).

## Reuse and licensing

Create a separate web repository rather than inheriting the whole desktop application. Reference Sony Device Center at the audited commit:

```text
dea38969b501a4a167f330dff104414531e80eae
```

Selectively adapt framing, command layouts and useful tests. Independently review session scheduling, error handling and capability inference; this audit identified reasons not to translate those mechanically.

Sony Device Center carries an MIT license. Preserve required notices for reused material, including in the deployed distribution. Gadgetbridge identifies its code and documentation as AGPLv3: do not assume its source can be translated into an MIT-only project without considering those terms. Record exact file provenance before importing code. [Source inventory](docs/sources.md).

Adapted Sony Device Center material is listed file by file in the [reuse manifest](docs/reuse-manifest.md); its MIT notice ships in `THIRD_PARTY_NOTICES.txt`. WebMDR itself is released under the [MIT License](LICENSE).

## Development milestones

| Step | Exit criterion |
| --- | --- |
| Codec + transport lifecycle | Independent byte fixtures pass; open/close/reopen works |
| Read-only Sony session | Source-backed initialization and current-state query receive valid, fresh replies |
| One setting change | An explicitly requested change is confirmed by subsequent device state |
| Minimal UI | Controls preserve sibling fields and remain truthful on timeout/disconnect |
| Pages release | The same tested build works from its deployed HTTPS origin |
| Additional devices | Model/firmware/feature evidence is added to the matrix |

A short passive RX observation is a diagnostic aid, not a prerequisite that must produce data. The audited V2 implementation initiates communication from the host.

```sh
npm ci
npm run dev        # local development server
npm run verify     # type-check, unit tests, production build, dist checks (same as CI)
```

## Deployment and privacy

The build base defaults to `/WebMDR/`, matching this repository's project site; set `WEBMDR_BASE=/` for a user site or custom-domain root. `npm run check:dist` verifies the base, CSP and notices. Deployment runs only through the manually triggered Pages workflow. GitHub Pages supports HTTPS. Test the deployed origin separately from localhost. [Deployment references](docs/sources.md#browser-and-hosting).

Bundle application dependencies rather than loading arbitrary runtime scripts. Keep protocol data local. Diagnostics must be opt-in and reviewed for personal identifiers before export. A browser page is not an always-running native controller; do not promise control after it is closed.

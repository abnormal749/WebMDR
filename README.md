<p align="center"><img src="public/icon-180.png" alt="" width="96" height="96"></p>

<h1 align="center">WebMDR</h1>

<p align="center"><strong>Noise control for Sony headphones, in your browser.</strong><br>
No app, no account, no server: a static web page that talks to your headphones over Bluetooth.</p>

<p align="center">
  <a href="https://abnormal749.github.io/WebMDR/"><strong>Open WebMDR</strong></a> ·
  <a href="#status">Status</a> ·
  <a href="#known-issues-and-limitations">Known issues</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <a href="https://github.com/abnormal749/WebMDR/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/abnormal749/WebMDR/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
</p>

Independent project; not affiliated with or endorsed by Sony. "WebMDR" is a working name, not a claim of trademark clearance.

## What it does

- Switch between **Noise cancelling**, **Ambient sound** and **Off**.
- Set the **Ambient level** (live while you drag) and **Voice passthrough**.
- Follow changes you make with the headphone buttons.
- Show the firmware version the headphones report.

Every change is confirmed by reading the setting back from the headphones. If that can't be confirmed, the page says so instead of pretending it worked.

## Use it

1. Pair the headphones with your computer in the system Bluetooth settings.
2. Open **https://abnormal749.github.io/WebMDR/** in desktop **Chrome**. Other Chromium browsers such as Edge may work but are untested.
3. Click **Connect** and pick your headphones.

Turn on **Advanced** (top right) for connection details, read-only/passive session modes and the protocol log. The log stays in the page: nothing is uploaded or stored.

The page only works while it is open; closing it disconnects.

## Supported headphones

The protocol is chosen from the Bluetooth service the headphones expose, never from their name.

| Protocol | Tested in WebMDR | Expected to work (listed by upstream, untested here) |
| --- | --- | --- |
| Sony V2 | **WH-1000XM5** (firmware 2.5.1) | WH-1000XM6, WF-1000XM4, WF-1000XM5, WF-1000XM6, WH-CH720N, ULT WEAR, LinkBuds S, newer WH-1000XM4 units |
| Sony V1 | none | WH-1000XM3, older WH-1000XM4 units |

On V1 headphones the page asks you to enable the untested controls explicitly. If your model isn't in the tested column, a [hardware report](https://github.com/abnormal749/WebMDR/issues/new?template=hardware-report.yml) is the most useful contribution you can make.

## Status

*Last updated 2026-09-25.*

| Milestone | State | Evidence |
| --- | --- | --- |
| Frame codec, session, noise-control logic | Done | Unit tests with a fake transport and fake time |
| Connect, initialize, read state | Done on XM5 | [H-003](docs/device-matrix.md#h-003--wh-1000xm5-noise-control-session-capture), replayed in CI |
| Change settings, confirmed by read-back | Done on XM5 | NC / Ambient / Off, levels 1–20, voice passthrough ([H-003, H-004](docs/device-matrix.md)) |
| Adopt headphone-button changes; handle power-off | Done on XM5 | [H-005](docs/device-matrix.md#h-005--wh-1000xm5-from-the-deployed-site-button-changes-power-off) |
| Published site | Done | Tested from the GitHub Pages origin (H-005, H-006) |
| V1 protocol and other V2 models | Code done | **Needs hardware reports** |
| Firmware version display | Code done | Not yet observed on hardware |

Hardware results are recorded in the [evidence record](docs/device-matrix.md). Unit tests are never counted as hardware validation.

## Known issues and limitations

- **Reconnecting after the headphones are switched off and on needs a Chrome restart** (macOS, Chrome 154). Opening the port fails with `NetworkError: Failed to open serial port` until Chrome is quit and reopened, whatever the page does: disconnecting first, forgetting the device and choosing it again all fail the same way. The stale state is inside the browser or the macOS Bluetooth stack, and no web API can clear it. **Workaround:** quit Chrome (⌘Q) and reopen the page. [Details and open questions](docs/device-matrix.md#known-issue-no-reconnect-after-a-headset-power-cycle-until-chrome-restarts).
- **The model can't be detected.** Web Serial hides the Bluetooth name, and no reviewed Sony command returns the model, so the page shows the protocol and firmware instead.
- **Only one headset model has been tested.** Some V2 models may use a different noise-control code; on those, the page stops at "not ready" without changing anything.
- **Browsers:** desktop Chrome on macOS is tested. Windows, Linux and Android Chrome 138+ have the API but are untested. Safari and Firefox have no Web Serial.
- **Not tested:** audio playback during a session, multipoint connections, sleep.
- **No background control:** there is no native helper, and the page can't act after it is closed.

## Contributing

Contributions are welcome, especially **hardware reports for models other than the WH-1000XM5**. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, the rules protocol code follows, and how to test with real headphones.

```sh
npm ci
npm run dev       # local server at http://localhost:5173
npm run verify    # type-check, tests, production build, dist checks (same as CI)
```

## How it works

```text
Static HTTPS page → Web Serial → Bluetooth RFCOMM → Sony control service
```

```text
src/ui/          page and DOM (the only code that touches the DOM)
src/app/         controller: connection phases, one in-flight change, confirmation
src/features/    noise-control state, merging edits
src/protocol/    frame codec, session (ACKs, sequencing, timeouts), V1/V2 layouts, profiles
src/transport/   Web Serial port selection, open/close
test/            unit tests, fake transport, captured sessions replayed in CI
```

A browser write, a protocol ACK and a confirmed setting are treated as three different outcomes. The session runs one transaction at a time and lets ACKs bypass the queue. An ambiguous timeout is reported as "unknown" and never retried blindly. The [technical review](docs/technical-review.md) explains why.

## Documentation

| Document | Contents |
| --- | --- |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Setup, workflow, pull-request checklist |
| [AGENTS.md](AGENTS.md) | Protocol and architecture contract (for humans and coding agents) |
| [docs/hardware-test.md](docs/hardware-test.md) | Step-by-step test with real headphones |
| [docs/device-matrix.md](docs/device-matrix.md) | Hardware evidence records H-001 to H-006 |
| [docs/technical-review.md](docs/technical-review.md) | Frame format, session design, reasons for each rule |
| [docs/sources.md](docs/sources.md) | Sources reviewed and what each supports |
| [docs/reuse-manifest.md](docs/reuse-manifest.md) | Every file adapted from third-party code |

## Privacy

The page has no backend, analytics or telemetry, and loads no third-party scripts at run time; a strict content-security policy is applied to the build. Protocol data stays in the page. The protocol log is kept in memory only and shown only under **Advanced**.

## License and credits

WebMDR is released under the [MIT License](LICENSE).

The frame format and command layouts are adapted from [Sony Device Center](https://github.com/marconvcm/sony-device-center) (MIT) at commit `dea38969b501a4a167f330dff104414531e80eae`. Its notice ships in [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt) and in the deployed site, and every adapted file is listed in the [reuse manifest](docs/reuse-manifest.md). No Gadgetbridge (AGPLv3) code is used; it was read for protocol facts only.

# Changelog

All notable changes to WebMDR. Versions follow [Semantic Versioning](https://semver.org/); before 1.0, minor versions may change behavior.

## [0.1.0] — 2026-09-25

First release. Live at https://abnormal749.github.io/WebMDR/.

### Features

- Connect to Sony headphones from desktop Chrome over Web Serial (Bluetooth RFCOMM), with no app, account or server.
- Switch Noise cancelling / Ambient sound / Off; set the ambient level (live while dragging) and voice passthrough.
- Every change is confirmed by reading the setting back from the headphones; an unconfirmed change is reported as unknown, never as success.
- Changes made with the headphone buttons are followed on the page.
- Shows the firmware version the headphones report.
- The protocol (Sony V2 or legacy V1) is chosen from the headphones' Bluetooth service, never from a name or a guess.
- **Advanced** switch: connection stages, evidence, Control / Read-only / Passive session modes, **Read state**, **Forget headphones**, and a protocol log that is kept in memory only.
- Light and dark mode follow the system; the page disconnects when closed.
- Strict content-security policy, no third-party scripts at run time, no telemetry.

### Hardware evidence

| Headphones | Result |
| --- | --- |
| WH-1000XM5, firmware 2.5.1 (macOS, Chrome 154) | All modes, levels 1–20, voice passthrough, button changes and power-off handling verified ([H-001 to H-006](docs/device-matrix.md)) |
| Other V2 models and V1 models (WH-1000XM3, older WH-1000XM4) | Implemented from upstream source; **not tested on hardware**. V1 controls require an explicit opt-in on the page |

### Known issues

- After the headphones are switched off and on, Chrome on macOS cannot reconnect until Chrome is restarted. No web API can clear this; quit Chrome (⌘Q) and reopen the page. ([details](docs/device-matrix.md#known-issue-no-reconnect-after-a-headset-power-cycle-until-chrome-restarts))
- The headphone model cannot be detected; the page shows the protocol and firmware instead.
- The firmware query has not yet been observed on hardware.
- Safari, Firefox, iPhone and iPad are not supported (no Web Serial). Windows, Linux and Android Chrome are untested.

[0.1.0]: https://github.com/abnormal749/WebMDR/releases/tag/v0.1.0

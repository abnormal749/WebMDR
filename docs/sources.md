# Sources and provenance

Reviewed 2026-09-25. Each source supports only the stated scope. Existing native code is evidence for a port, not proof that the port works on hardware.

## Sony Device Center — pinned review

Repository: `marconvcm/sony-device-center`.

Commit: `dea38969b501a4a167f330dff104414531e80eae` (main when inspected; commit dated 2026-09-13).

| Source | Reviewed scope |
| --- | --- |
| [Client/Constants.h](https://github.com/marconvcm/sony-device-center/blob/dea38969b501a4a167f330dff104414531e80eae/Client/Constants.h) | Actual legacy/newer service UUIDs, command and frame-family constants |
| [FrameCodec.cpp](https://github.com/marconvcm/sony-device-center/blob/dea38969b501a4a167f330dff104414531e80eae/libs/sony-protocol/src/FrameCodec.cpp) | Framing, escaping, checksum, length checking |
| [SonyProtocolSession.cpp](https://github.com/marconvcm/sony-device-center/blob/dea38969b501a4a167f330dff104414531e80eae/libs/sony-protocol/src/SonyProtocolSession.cpp) | ACKs, sequencing, buffering and transaction matching |
| [ProtocolV2.cpp](https://github.com/marconvcm/sony-device-center/blob/dea38969b501a4a167f330dff104414531e80eae/libs/sony-protocol/src/ProtocolV2.cpp) | Host initialization, noise-control queries and combined setter |
| [ProtocolV1.cpp](https://github.com/marconvcm/sony-device-center/blob/dea38969b501a4a167f330dff104414531e80eae/libs/sony-protocol/src/ProtocolV1.cpp) | Initial portion: V1 initialization, battery, noise read/set and opcode warning |
| [DeviceProfileRegistry.cpp](https://github.com/marconvcm/sony-device-center/blob/dea38969b501a4a167f330dff104414531e80eae/libs/sony-protocol/src/DeviceProfileRegistry.cpp) | Name-based identification, static capabilities and unknown-device fallback |
| [CapabilityDiscovery.cpp](https://github.com/marconvcm/sony-device-center/blob/dea38969b501a4a167f330dff104414531e80eae/libs/sony-protocol/src/CapabilityDiscovery.cpp) | Static fast path and query-based capability inference |
| [README](https://github.com/marconvcm/sony-device-center/blob/dea38969b501a4a167f330dff104414531e80eae/README.md) | Upstream support claims and documented UUID discrepancy; not a WebMDR support matrix |
| [LICENSE](https://github.com/marconvcm/sony-device-center/blob/dea38969b501a4a167f330dff104414531e80eae/LICENSE) | MIT notice and required preservation of notices |
| [MacOSBluetoothConnector.mm](https://github.com/marconvcm/sony-device-center/blob/dea38969b501a4a167f330dff104414531e80eae/Client/macos/MacOSBluetoothConnector.mm) | Protocol version chosen from the service record found (legacy UUID -> V1, else V2) |
| [HeadphonesBridge.mm](https://github.com/marconvcm/sony-device-center/blob/dea38969b501a4a167f330dff104414531e80eae/Client/macos/HeadphonesBridge.mm) | Maximum ambient level exposed per protocol version (V2 20, V1 19) |
| [ProtocolV1Tests.cpp](https://github.com/marconvcm/sony-device-center/blob/dea38969b501a4a167f330dff104414531e80eae/tests/protocol/ProtocolV1Tests.cpp) | V1 noise-control reply and setter byte fixtures |

These files were inspected; upstream's entire test suite, all device reports and all transitive code provenance were not audited. Static-review concerns are not presented as reproduced upstream defects.

Before importing implementation, record the source revision, exact path, local destination and license in a reuse manifest. Preserve required notices in deployed artifacts as well as the source tree.

## Other protocol prior art

[Gadgetbridge](https://gadgetbridge.org/) identifies its application and documentation as AGPLv3. Its current project links lead to Codeberg. No Gadgetbridge implementation is copied into this documentation bundle, and its Sony implementation was not line-by-line audited here. Check exact file licensing before reuse; a change of programming language does not erase licensing questions.

Read on 2026-09-25 for protocol facts only (no code or text copied), from the Codeberg `master` branch (not pinned): `service/devices/sony/headphones/protocol/impl/v1/SonyProtocolImplV1.java` and `.../v2/SonyProtocolImplV2.java`, both AGPLv3. Findings used in WebMDR: firmware query `04 02 -> 05 <len> <ASCII>`, no model-name query, and noise-control subtype `0x15` or `0x17` chosen per device.

## Browser and hosting

| Primary source | Scope |
| --- | --- |
| [Chrome: Serial over Bluetooth](https://developer.chrome.com/blog/serial-over-bluetooth) | Desktop RFCOMM support, custom services, chooser filtering |
| [Chrome 138 release notes](https://developer.chrome.com/release-notes/138) | Android Bluetooth RFCOMM Web Serial support, released 2025-06-24 |
| [Chrome: RFCOMM availability updates](https://developer.chrome.com/blog/bluetooth-rfcomm-updates-web-serial) | Logical availability and `SerialPort.connected` from desktop Chrome 130 |
| [Chrome: Web Serial usage](https://developer.chrome.com/docs/capabilities/serial) | Permission, binary streams, reader/writer locks and closure |
| [Chromium SerialPortInfo IDL](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/modules/serial/serial_port_info.idl) | Optional USB IDs/service UUID; no Bluetooth name, MAC or model member |
| [Chromium Serial IDL](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/modules/serial/serial.idl) | Secure context, window/dedicated-worker exposure and window-only requestPort |
| [GitHub Pages HTTPS](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https) | HTTPS hosting |
| [Vite static deployment](https://vite.dev/guide/static-deploy#github-pages) | Build output and project-site base path |

Chromium interface links are to the branch inspected on the review date, not a permanently pinned release. Record a commit when using them as long-lived test fixtures.

## Hardware source

[H-001](device-matrix.md) is a sanitized record of user-supplied SDP output and subsequent browser test output. It is not hosted by upstream and does not include a protocol capture. Never label source-derived or generated packet fixtures as captured from H-001.

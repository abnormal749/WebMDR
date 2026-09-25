# Hardware evidence

Last reviewed: 2026-09-25. This is a sanitized record of user-operated tests in the development conversation, not an independently reproduced lab report.

## H-001 — WH-1000XM5 transport probe

| Field | Recorded value |
| --- | --- |
| Device | Sony WH-1000XM5 |
| Firmware | 2.5.1, reported by macOS system profiler |
| Host | macOS; exact version not recorded |
| Browser | Desktop Chrome; exact version not recorded |
| Page | Localhost prototype; no deployed Pages result supplied |
| SDP service | Serial HPC |
| Service UUID | `956c7b26-d49a-4ba8-b03f-b17d393cb6e2` |
| SDP RFCOMM channel | 9; observation only |
| Selection | Passed, matching UUID reported by `getInfo()` |
| Open | Passed with `baudRate: 9600` |
| Streams | `readable: true`, `writable: true` |
| Sony protocol TX/RX | Not yet tested |
| ANC / Ambient / Off / level / voice focus | Not yet tested |
| Audio coexistence / sleep / reconnect / multipoint | Not yet tested |

The service record came from the user's Objective-C diagnostic output. That prototype started an asynchronous SDP query but could read an existing service cache before completion. Accordingly, this record does not claim a freshly completed, exhaustive SDP query. Subsequent filtered selection and successful browser open corroborate the service endpoint itself.

Personal Bluetooth addresses, device names belonging to other devices, and serial numbers are intentionally omitted.

## Validation vocabulary

Use separate results rather than one ambiguous “supported” badge:

| Stage | Required evidence |
| --- | --- |
| Service selected | Browser returned the expected service UUID |
| Transport opened | Open succeeded and streams were available |
| Protocol identified | A reviewed exchange returned a structurally valid reply |
| Feature read | Fresh state was decoded and checked against device behavior |
| Feature changed | Explicitly requested setting was confirmed after the write |
| Lifecycle checked | Close/reopen, loss of connection and pending-work cancellation passed |
| Deployed-site checked | Test passed from the published HTTPS origin |

For each future report, record date, exact model/firmware, OS/browser versions, app commit, origin, service UUID, feature and result. Missing data should remain missing; do not backfill from unrelated machine history.

No additional model is currently verified in WebMDR. Native upstream support is tracked separately as candidate evidence, not copied into this matrix.

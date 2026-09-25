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

## H-002 — WH-1000XM5 ambient level change

| Field | Recorded value |
| --- | --- |
| Date | 2026-09-25 |
| Device | Sony WH-1000XM5 (user-operated) |
| Firmware | Not re-reported for this test (H-001 recorded 2.5.1) |
| Host / browser | macOS + desktop Chrome; exact versions not recorded |
| Build | Implementation at commit `628564c`, run from a local working tree before commit; origin (dev server or preview) not recorded |
| User report | "I can control the ambient level on the browser correctly." |
| Protocol identified | Inferred from code, not separately reported: controls are enabled only after an init reply (`01 …`) and a schema-valid `67 17 01 …` state reply |
| Ambient level change | Passed per user report |
| UI result line (Confirmed / Mismatch / Unknown) | Not recorded |
| ACK sequence values | Not recorded (log not supplied) |
| Off / NC / Ambient switching, voice focus | Not reported |
| Button adoption, close/reopen, power-off during session | Not reported |
| Deployed Pages origin | Not tested |

No diagnostic log was supplied, so this record contains no protocol capture and no fixture may be labelled as captured from it.

## H-003 — WH-1000XM5 noise-control session capture

| Field | Recorded value |
| --- | --- |
| Date | 2026-09-25 (log times are UTC) |
| Device | Sony WH-1000XM5 (user-operated) |
| Firmware | Not reported |
| Host / browser | Not reported |
| Origin / build | Not reported (the log header recording both was added after this test) |
| Capture | Diagnostics log, decoded frames: [`test/captures/h003.log`](../test/captures/h003.log). Raw wire bytes were not logged; every frame passed checksum and length validation. |
| Replay | `test/replay.test.ts` feeds the captured RX back and requires the identical log, TX bytes and sequence numbers |

| Stage | Result |
| --- | --- |
| Protocol identified | Pass: `00 00` → 8-byte reply `01 00 03 00 20 16 00 00`, identical on 3 connections |
| ACK rule | Pass: all 23 host data frames with seq `s` were ACKed with `1 - s`; device data frames alternate starting at seq 1 per connection |
| Feature read | Pass: `66 17` → `67 17 01 …` on every read; level retained while Off/NC (reported `0c`) |
| Feature changed | Pass, each confirmed by a fresh read-back: Off, NC, Ambient; levels 3, 17, 12; voice passthrough on and off |
| Notifications | The headset sends `69 17 01 …` (same layout as `67`) after each change, before the read-back |
| Lifecycle | Partial: 3 clean close/reopen cycles; button adoption and power-off during a session not tested |
| Timing (browser receipt times) | Change → ACK 21–47 ms; read → reply 21–71 ms; change → confirming reply 45–119 ms |
| Deployed-site checked | Not recorded |

## H-004 — WH-1000XM5 level range and power-off

| Field | Recorded value |
| --- | --- |
| Date | 2026-09-25 (log times are UTC) |
| Device | Sony WH-1000XM5 (user-operated) |
| Firmware | Not reported |
| Browser | Chrome 154.0.8037.57 (Official Build) (arm64); macOS version not reported |
| Build | Earlier than `e5e325f` (inferred: the log lacks the build header and UTC marker added there); origin not recorded |
| Capture | [`test/captures/h004.log`](../test/captures/h004.log), decoded frames; replayed in `test/replay.test.ts` |

| Stage | Result |
| --- | --- |
| Protocol identified | Pass: same 8-byte init reply as H-003 |
| Feature changed | Pass, each confirmed by read-back: levels 1, 20, 18, 17, 11, 8, 6, 4, 3, 1, 2, 7 — both ends of the 1–20 range accepted |
| Timing | Change → ACK 18–47 ms; change → confirming reply 41–140 ms |
| Unidentified notification | `a5 01 00 02 00` (seq 1) arrived 327 ms before the link was lost during power-off; ACKed, logged, not interpreted |
| Power-off during session | Chrome reported `The device has been lost.`; session closed and controls disabled. The extra "cleanup failed" line came from cancelling an already-errored stream (fixed after this test) |
| Reconnect after power-on | **Fail**: not possible, also from a new page. Error text not recorded; cause unknown (see below) |

## H-005 — WH-1000XM5 from the deployed site; button changes; power-off

| Field | Recorded value |
| --- | --- |
| Date | 2026-09-25 (log times UTC) |
| Device | Sony WH-1000XM5 (user-operated); firmware not reported |
| Browser | Chrome 154.0.8037.57 (arm64) as reported with H-004 minutes earlier; not re-reported; macOS version not reported |
| Build / origin | `55184b0` at `https://abnormal749.github.io` (from the log header) |
| Capture | Diagnostics log supplied in conversation; not stored as a fixture (no host-initiated changes to replay beyond H-003/H-004) |

| Stage | Result |
| --- | --- |
| Deployed-site checked | Pass for connect, init, state reads and notifications from the published HTTPS origin; no setting change in this log |
| External changes (headset button) | Pass: seven `69 17 01 …` notifications cycling NC → Ambient → Off → NC were adopted; WebMDR sent no setter in response |
| Close / reopen by user | Pass (one cycle) |
| Power-off during session | Pass: session closed on `The device has been lost.` with no cleanup error (fix from `2461ce9`) |
| Chrome events after power-off / power-on | 13 `disconnect` then 13 `connect` events at once; which ports they belonged to was not logged (now logged) |
| Reopen after power-on | **Fail**: three attempts, each `NetworkError: Failed to open serial port.` after ~10 s, while Chrome reported the device available |
| Recovery | Quitting Chrome restored reconnect (user report); the failure recurs after the next power-off (user report) |

### Open issue: no reconnect after power-off until Chrome restarts

The page closes the port cleanly (H-005 shows no cleanup error) and Chrome reports the device available again, yet `open()` times out until Chrome is restarted; a new page does not help. The stale state is therefore below the page, in Chrome's browser process or macOS Bluetooth. No page API is documented to clear it. A 2022 spec thread reports the same `Failed to open serial port` on reopen without resolution ([WICG/serial#156](https://github.com/WICG/serial/issues/156)).

Workaround: quit Chrome (⌘Q) and reopen WebMDR. The page now shows this after such a failure.

Experiments still to run, one per power-cycle, with Diagnostics on:

1. **Forget headset**, then **Choose headset…** again: does `port.forget()` release the stale state?
2. **Disconnect** in WebMDR *before* switching the headset off: is the failure specific to losing the device while the port is open?

If neither helps, the evidence supports a Chromium bug report (not filed; needs the owner's decision and a search of existing reports first).

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

No other model has been tested in WebMDR. Native upstream support is tracked separately as candidate evidence, not copied into this matrix.

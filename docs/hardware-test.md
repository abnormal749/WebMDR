# Opted-in hardware test

Unit tests use a fake transport and fake time. They do not show that any byte works on a headset. Use this procedure to produce the next hardware evidence record; record results in [device-matrix.md](device-matrix.md) as a new `H-00n` entry.

## Before starting

- Record: date, headset model and firmware, OS and browser **exact** versions, WebMDR commit (`git rev-parse HEAD`), origin (`http://localhost:5173` or the Pages URL).
- `npm ci && npm run dev`, open the printed localhost URL in desktop Chrome.
- Turn on **Advanced** (top right). It shows connection details, the firmware version the headset reports, and the protocol log. The log's first line records the WebMDR build and origin; times are UTC; it otherwise contains frame bytes only. Review it before sharing; do not add device names, addresses or serial numbers.

## Steps and what each result shows

| Step | Pass criterion | Validation stage |
| --- | --- | --- |
| 1. Advanced → Passive, Connect, wait ~30 s, Disconnect | Port opens; any RX is logged; **no TX lines** | Service selected / transport opened |
| 2. Advanced → Read-only, Connect | Log shows the init exchange (V2 only), `TX Read noise-control state` with a valid reply, and `TX Read firmware version`; Advanced shows *Protocol ready* and the firmware | Protocol identified |
| 3. Note whether ACK RX frames carry seq `1 - tx seq` | Record the observed ACK sequence values | ACK semantics |
| 4. Change mode with the headset button, then **Read state** | Reported mode matches the headset | Feature read |
| 5. Disconnect, Connect again | Clean reopen; no setter sent | Lifecycle |
| 6. Advanced → Control (the default), change one setting | The page says *Saved.*; Advanced shows *Confirmed by device read-back*; the headset audibly matches | Feature changed |
| 7. Turn the headset off during a connected session | Page reports disconnected; controls hidden | Lifecycle |

A step that fails or times out is recorded as such with the log excerpt. A timeout is inconclusive, not evidence that a feature is unsupported.

## Testing another model

The page cannot detect the model, so write down the exact model name yourself, plus the firmware and the **Protocol** row Advanced shows (Sony V2 or Sony V1). Start in Read-only mode: a pass there is "Protocol identified" and "Feature read" for that model. Only then try Control mode; on V1 the page asks you to enable untested controls explicitly. A read failure with a "malformed" message is useful evidence of a different layout; include the log.

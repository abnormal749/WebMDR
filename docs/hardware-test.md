# Opted-in hardware test

Unit tests use a fake transport and fake time. They do not show that any byte works on a headset. Use this procedure to produce the next hardware evidence record; record results in [device-matrix.md](device-matrix.md) as a new `H-00n` entry.

## Before starting

- Record: date, headset model and firmware, OS and browser **exact** versions, WebMDR commit (`git rev-parse HEAD`), origin (`http://localhost:5173` or the Pages URL).
- `npm ci && npm run dev`, open the printed localhost URL in desktop Chrome.
- Enable **Diagnostics**. The log contains frame bytes only. Review it before sharing; do not add device names, addresses or serial numbers.

## Steps and what each result shows

| Step | Pass criterion | Validation stage |
| --- | --- | --- |
| 1. Passive, Choose headset, wait ~30 s, Disconnect | Port opens; any RX is logged; **no TX lines** | Service selected / transport opened |
| 2. Read-only, Connect | Log shows `TX V2 host initialization`, an RX with payload starting `01`, then `TX Read noise-control state` and an RX `67 17 01 …`; page says *Protocol ready* | Protocol identified |
| 3. Note whether ACK RX frames carry seq `1 - tx seq` | Record the observed ACK sequence values | ACK semantics (currently source-derived only) |
| 4. Change mode with the headset button, then **Read state** | Reported mode matches the headset | Feature read |
| 5. Disconnect, Connect again | Clean reopen; no setter sent | Lifecycle |
| 6. Control mode + opt-in, change one setting | Result reads *Confirmed by device read-back* and the headset audibly matches | Feature changed |
| 7. Turn the headset off during a connected session | Page reports disconnected; controls disabled | Lifecycle |

A step that fails or times out is recorded as such with the log excerpt. A timeout is inconclusive, not evidence that a feature is unsupported.

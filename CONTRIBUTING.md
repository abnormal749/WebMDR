# Contributing to WebMDR

Thanks for helping. The most valuable contributions right now are:

1. **Hardware reports** for any model other than the WH-1000XM5, and for Windows, Linux or Android. Use the [hardware report form](https://github.com/abnormal749/WebMDR/issues/new?template=hardware-report.yml); [docs/hardware-test.md](docs/hardware-test.md) walks through the test.
2. **Bug reports** with the protocol log from the page's **Advanced** panel.
3. **Code** that fixes a reported problem or adds a feature backed by evidence (see below).

For a larger change, open an issue first so we can agree on the approach before you write it.

## Setup

Requires Node 24 (the version CI uses).

```sh
git clone https://github.com/abnormal749/WebMDR.git
cd WebMDR
npm ci
npm run dev        # http://localhost:5173
```

Web Serial needs a secure context; `localhost` counts. You don't need headphones for most work: tests use a fake transport and fake time.

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm test` | Unit tests (Vitest) |
| `npm run typecheck` | TypeScript, strict |
| `npm run build` | Production build into `dist/`, base path `/WebMDR/` |
| `npm run preview` | Serve the production build locally |
| `npm run verify` | Everything CI runs: type-check, tests, build, dist checks |

Run `npm run verify` before opening a pull request. The build base defaults to `/WebMDR/` for the project site; set `WEBMDR_BASE=/` to build for a domain root.

## Project layout

```text
src/protocol/    codec.ts (framing), session.ts (ACKs, sequencing, timeouts),
                 v1.ts / v2.ts (command layouts), deviceInfo.ts, profiles.ts (data table)
src/features/    noise-control state and edit merging
src/app/         controller: phases, one in-flight change, confirmation
src/transport/   Web Serial port selection and lifecycle
src/ui/          the page; the only code that touches the DOM
test/            unit tests, fakes, captured sessions (test/captures/) replayed in CI
docs/            evidence record, technical review, sources, reuse manifest
```

## Rules for protocol code

The full contract is in [AGENTS.md](AGENTS.md); the reasons are in the [technical review](docs/technical-review.md). In short:

- **Every byte sent has a source.** A new command needs its purpose, its source (file and commit), the dialect it belongs to and a byte-level test. The UI never builds packets.
- **Evidence, not guesses.** Nothing is sent to find out which device is connected; the dialect comes from the Bluetooth service UUID only. A timeout means "unknown", never "unsupported". Don't mark anything `hardware-verified` without a hardware report.
- **Never send V2 opcode `0x22`** as a probe: on V1 it means power off.
- **Three separate outcomes:** browser write resolved, protocol ACK, setting confirmed by the device. Don't show success for the first two.
- **One transaction at a time; no blind retries.** After an ambiguous timeout the session stops rather than resending.
- **Tests must catch the bug.** Use independent byte fixtures, not only `decode(encode(x))`. When fixing a bug, add a test that fails without the fix.

## Reusing third-party code

Sony Device Center (MIT) is the reference, pinned at `dea38969b501a4a167f330dff104414531e80eae`. If you adapt anything from it, add a row to [docs/reuse-manifest.md](docs/reuse-manifest.md) with source path, destination and modifications. **Do not copy Gadgetbridge code**: it is AGPLv3 and can't go into this MIT project. Reading it for protocol facts is fine; cite the file in [docs/sources.md](docs/sources.md).

## Fixtures, logs and privacy

- Label every fixture as *captured*, *upstream-derived* or *synthetic*. Only a real session log with its recorded context counts as captured.
- Never commit Bluetooth addresses, device names, serial numbers, local paths or email addresses. The page's log contains only frame bytes, times, the build and the origin; review it before posting anyway.

## Pull requests

- Keep each PR to one concern, with commits that pass `npm run verify` on their own.
- Explain what changed in behavior, how you tested it, and what remains unknown.
- If you tested on hardware, say which model, firmware, OS and browser, with exact versions.
- Update the docs your change affects (README status, evidence record, reuse manifest).

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).

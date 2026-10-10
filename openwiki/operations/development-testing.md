---
type: operations
title: Development & Testing
description: Build, test, and protobuf-generation workflows for the ZeroHub monorepo — Makefile targets, server unit tests, the dual-server Playwright E2E harness, and repository conventions and known pitfalls.
tags: [testing, e2e, playwright, build, protobuf, conventions, makefile]
sources:
  - id: openwiki-source-9ab161c6e9774cf771b19ced
    resource: repo://.zerofactory/precommit.sh
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-b7181b4d7359d016a13b092d
    resource: repo://test/package.json
  - id: openwiki-source-bb910847e63080c9ced0e830
    resource: repo://test/playwright.config.ts
generated: { by: "hermes", at: "2026-10-10T01:28:37.861Z" }
verified:
  - by: openwiki/0.6.0
    at: 2026-10-10T01:28:37.861Z
---

# Development & Testing

ZeroHub is a monorepo with two build systems (Go server, TypeScript client)
plus an E2E test suite that drives the real client against two live servers.
This page maps the build/test workflows, the factory precommit gate, and the
conventions that keep the repo green.

## Build & test entry points

The root `Makefile` is the primary orchestration point. Key targets:

| Target | What it does |
|---|---|
| `server-serve` | Run the server (`APP_CLIENT_SECRET=client_secret go run ./cmd/server.go`) |
| `server-serve-2` | Run a second server on `APP_PORT=8081` |
| `server-test` | `go test -v ./...` in `server/` |
| `server-bench` | `go test -bench ./pkg/*** -benchmem` |
| `client-build` | `npm run build` in `client/` (tsc + rollup → dist) |
| `e2e-test` | Kills ports, spawns two servers on 8080/8081, waits, runs `test/`, kills servers |
| `test-all` | `server-test` + `e2e-test` in parallel (`-j3`) |
| `proto-gen` | Runs `api-linter`, then regenerates TS + Go protobuf for both |
| `server-mock` | Regenerate gomock mocks for `zerohub`, `hub`, `peer` |
| `kill-server` | Kill whatever is LISTENing on 8080/8081 |

## Protobuf regeneration

The wire protocol is defined in `proto/zerohub/v1/*.proto`. **Never hand-edit
the generated code** in `client/src/proto/` or `server/pkg/proto/`. After any
`.proto` change run:

```
make proto-gen
```

which runs `api-linter` on the proto, wipes the generated dirs, and invokes
`protoc` with `protoc-gen-ts_proto` (TypeScript, ts-proto) and `protoc-gen-go`
(paths=source_relative) in one pass. The client's `prettier` format:check globs
`src/**/*`, so keep the generated proto files' Prettier formatting in sync so
`npm run check` stays green after regeneration.

## Client development

In `client/`:

- `npm run build` — clean, typecheck (`tsc`), and rollup to `dist/` (ESM, CJS,
  types).
- `npm run check` — `lint` (ESLint) + `format:check` (Prettier) + `tsc`.
- `npm run lint:fix` / `npm run format` — auto-fix and reformat.
- `npm run docs` — Typedoc → Markdown.

## Server development

In `server/`:

- `go run cmd/server.go` (default port 8080) or `APP_PORT=8081 go run ...`.
- `go test -v ./...` for unit tests.
- `go test -bench ./pkg/*** -benchmem` for benchmarks.

Config comes from `.env` (copy `.env.example`); key vars are `APP_PORT`,
`APP_CLIENT_SECRET`. Regenerate mocks (`make server-mock`) after interface
changes in `pkg/zerohub/zerohub.go`, `pkg/hub/hub.go`, or `pkg/peer/peer.go`.

## E2E test suite

The `test/` directory is a Playwright suite using Svelte harness components
that instantiate the real `ZeroHubClient` (imported via relative path
`../../client/src/index`):

- **Harness** (`test/harness/index.ts`) exposes a `window.ZeroHubHarness`
  that creates/joins hubs, logs peer status changes, and tracks data-channel
  state, keyed by `componentId`. Tests drive it via `page.evaluate`.
- **Specs** (`test/tests/`): `connnect.spec.ts` (create/join + peer status),
  `data-channel.spec.ts`, `concurrent.spec.ts`, `disconnect.spec.ts`,
  `migrate.spec.ts`, `multihosts.spec.ts`, plus five `unit-*.spec.ts` specs
  (e.g. `unit-sfu-election.spec.ts`, `unit-reconnect-error.spec.ts`) that
  exercise client internals in a Playwright page through the unit harness
  (`test/unit-harness/index.ts`) with a mocked `RTCPeerConnection` — no live
  server or real WebRTC stack required.
- **Dual servers**: `make e2e-test` spins up two signaling servers on 8080 and
  8081 (for multi-host/failover tests), sleeps 3s, then runs the suite.

### Running the E2E suite correctly

- **Always run via `cd test && npm test`**, not `npx playwright test`
  directly. `npm test` triggers `pretest`, which runs `build:harness`
  (`test/dist/harness.js` for the E2E Svelte harness) **and**
  `build-unit-harness` (`test/dist/unit-harness.js` for the unit specs), both
  via esbuild. Invoking Playwright directly makes the specs fail with ENOENT
  on their missing harness bundles.
- The Playwright config runs **serially** (`fullyParallel: false`) with a 10s
  per-test timeout, Chrome-only. Under `CI=1` it sets `workers: 1` and
  `retries: 2`.
- **Parallel e2e runs flake under load** on pre-existing specs. To distinguish
  a real regression from load flakiness, run serially (`CI=1 npx playwright
  test`) or run each spec individually.

## Zero Factory precommit gate

`.zerofactory/precommit.sh` is the factory's deterministic verification gate,
run by the dispatcher before a PR is opened. It has three phases, each
runnable independently (`format`, `build`, `test`, or `all`):

- **format** — `gofmt -s -w` on `server/`, then `npm run fix` (ESLint --fix +
  Prettier --write) on `client/`.
- **build** — `go build ./... && go vet ./...` on `server/`, then
  `npm run tsc` on `client/`.
- **test** — `go test -count=1 ./...` on `server/`. The Playwright E2E suite is
  **skipped** here (it is infra-dependent: two live servers, a real browser,
  free ports) and left to CI / `make e2e-test`.

The script is **self-sufficient**: if `client/node_modules` is absent on a
fresh checkout it installs it on demand (`npm ci`, falling back to `npm
install`). Note `go test -race` is unusable on the ARM dev host
(ThreadSanitizer "unsupported VMA range"), so the gate uses plain `go test`
and relies on a CI runner for the race detector. `install-hook` symlinks
`.git/hooks/pre-commit` → this script.

## Repository conventions & pitfalls

- **Peer ID comparison** — always `parseInt()` when comparing peer IDs for
  offer/answer logic.
- **ICE timing** — wait `waitIceCandidatesTimeout` (default 2000 ms) before
  flushing the offer/answer.
- **Auto-answer** — defaults `true`; set `autoAnswer: false` only for manual
  offer handling.
- **Proto changes** — breaking wire changes require a client SDK version bump;
  regenerate both languages.
- **Cross-workspace imports** — test/examples use relative imports
  (`../../../client/src/index`), not the published package.
- **Zero Factory manages wiki updates natively** (via background Hermes cron),
  not external GitHub Actions — do not add `.github/workflows/openwiki-update.yml`.
- **STUN/TURN** — the client defaults to Google STUN servers; override via
  `rtcConfig`. TLS is `wss://` (set `tls: true` in the client config).

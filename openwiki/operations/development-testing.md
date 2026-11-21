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
  - id: openwiki-source-36a6408534491a7638f8089e
    resource: repo://test/tests/unit-ice-candidate-send.spec.ts
  - id: openwiki-source-1c91996f1afbceb960c6d3b4
    resource: repo://test/tests/unit-malformed-metadata.spec.ts
  - id: openwiki-source-7ceb47a072238480d4d7c02a
    resource: repo://test/tests/unit-manual-answer-handling.spec.ts
  - id: openwiki-source-7afb406b1f937d036581a006
    resource: repo://test/tests/unit-manual-offer-handling.spec.ts
  - id: openwiki-source-d5ba4efac3261c35045dc88c
    resource: repo://test/tests/unit-migration-redirect.spec.ts
  - id: openwiki-source-29851cc9f0534cab4748f6fb
    resource: repo://test/tests/unit-reconnect-peer-prune.spec.ts
  - id: openwiki-source-fc03789f03ea810eb48d9541
    resource: repo://test/tests/unit-static-hub-endpoints.spec.ts
  - id: openwiki-source-30c344265a55823115544978
    resource: repo://test/tests/unit-ws-replacement.spec.ts
  - id: openwiki-source-801ca2739d5984913a9ac0eb
    resource: repo://test/unit-harness/index.ts
generated: { by: "hermes", at: "2026-11-20T15:09:12.940Z" }
verified:
  - by: openwiki/0.6.0
    at: 2026-11-20T15:09:12.940Z
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
| `server-serve` | Run the server (`APP_CLIENT_SECRET=client_secret APP_ALLOWED_ORIGINS=null go run ./cmd/server.go`) |
| `server-serve-2` | Run a second server on `APP_PORT=8081` |
| `server-test` | `go test -v ./...` in `server/` |
| `client-typecheck` | `tsc` typecheck in `client/` |
| `client-test` | Runs `client-typecheck`, then the client vitest suite (`npm run test`) |
| `e2e-test` | Kills ports, spawns two servers on 8080/8081, waits, runs `test/`, kills servers, and exits with the Playwright status |
| `test-all` | `server-test` + `e2e-test` + `client-test` in parallel (`-j3`) |
| `proto-gen` | Runs `api-linter`, then regenerates TS + Go protobuf for both |
| `server-mock` | Regenerate the gomock mock for `zerohub` (the `hub`/`peer` mocks were removed as dead) |
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
`APP_CLIENT_SECRET`. Regenerate the zerohub mock (`make server-mock`) after
interface changes in `pkg/zerohub/zerohub.go` — the target only generates the
`zerohub` mock; the former `hub`/`peer` mockgen lines were removed as dead.

## E2E test suite

The `test/` directory is a Playwright suite whose E2E specs drive a
plain-TypeScript harness (`test/harness/index.ts`, bundled with esbuild to
`test/dist/harness.js`) that instantiates the real `ZeroHubClient` (imported
via relative path `../../client/src/index`):

- **Harness** (`test/harness/index.ts`) exposes a `window.ZeroHubHarness`
  that creates/joins hubs, logs peer status changes, and tracks data-channel
  state, keyed by `componentId`. Tests drive it via `page.evaluate`.
- **Specs** (`test/tests/`): seven E2E specs — `connect.spec.ts`
  (create/join + peer status), `data-channel.spec.ts`, `concurrent.spec.ts`,
  `disconnect.spec.ts`, `multihosts.spec.ts`, `static-hub.spec.ts` (out-of-band
  admin HTTP create + `joinStaticHub` WebSocket against the live `:8081` backup
  server), and `zz-migrate.spec.ts` (named last so its one-way migrate latch on
  `:8080` runs after every other spec) — plus 23 `unit-*.spec.ts` specs
  (e.g. `unit-sfu-election.spec.ts`, `unit-reconnect-error.spec.ts`,
  `unit-malformed-metadata.spec.ts`, `unit-reconnect-peer-prune.spec.ts`,
  `unit-ice-candidate-send.spec.ts`, `unit-manual-offer-handling.spec.ts`,
  `unit-manual-answer-handling.spec.ts`, `unit-migration-redirect.spec.ts`,
  `unit-static-hub-endpoints.spec.ts`, `unit-ws-replacement.spec.ts`) that
  exercise client internals in a Playwright page through the unit harness
  (`test/unit-harness/index.ts`, bundled to `test/dist/unit-harness.js`) with a
  mocked `RTCPeerConnection` and a `MockWebSocket` installed on `globalThis`
  (each mock socket is instance-tagged and records `close()` codes, so specs
  can detect a leaked or orphaned socket) — no live server or real WebRTC
  stack required. The malformed-metadata spec pins the `safeParseJson`
  fallback, the reconnect-peer-prune spec pins the `hubInfoMessage` roster
  reconciliation that removes stale peers, the ice-candidate-send spec pins the
  shared ICE-candidate wait-and-send behavior, the manual offer/answer specs
  pin the `onOffer`/`onAnswer` manual-SDP paths, the migration-redirect spec
  pins the 1001 close-reason host validation (and the self-redirect stop plus
  the `host`/`hostIndex` update on a valid redirect), the
  static-hub-endpoints spec pins that `joinStaticHub` dials
  `/v1/static-hubs/join` with the correct `id`/`peerMetadata` query params
  (static-hub create is deliberately NOT on the SDK — it is an admin-gated
  plain-HTTP endpoint), and the ws-replacement spec pins that a second
  entry-point call tears down the previous socket instead of leaking it.
- **Dual servers**: `make e2e-test` spins up two signaling servers on 8080 and
  8081 (for multi-host/failover tests), sleeps 3s, then runs the suite.

### Running the E2E suite correctly

- **Always run via `cd test && npm test`**, not `npx playwright test`
  directly. `npm test` triggers `pretest`, which runs the `tsc` typecheck
  **and** `build:harness` (`test/dist/harness.js` for the E2E harness) **and**
  the unit-harness bundle (`test/dist/unit-harness.js` for the unit specs),
  both built via esbuild. Invoking Playwright directly makes the specs fail
  with ENOENT on their missing harness bundles.
- The Playwright config runs **serially**: `workers: 1` and
  `fullyParallel: false` are always pinned (locally and on CI), with a 10s
  per-test timeout on Google Chrome only. `retries` is `2` under `CI=1` and
  `0` locally. The suite must stay single-worker because the specs share two
  live server processes and `zz-migrate.spec.ts` permanently latches one of
  them.
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
- **Auto-answer** — `autoAnswer` / `autoAcceptAnswer` default `true`; set
  `autoAnswer: false` to surface incoming offers via the `onOffer` callback
  (manual answer via `sendAnswer(peer.id, offerSdp)`) and
  `autoAcceptAnswer: false` to surface incoming answers via the `onAnswer`
  callback (manual accept via `acceptAnswer(peer.id, answerSdp)`).
- **Proto changes** — breaking wire changes require a client SDK version bump;
  regenerate both languages.
- **Cross-workspace imports** — test/examples use relative imports
  (`../../../client/src/index`), not the published package.
- **Zero Factory manages wiki updates natively** (via background Hermes cron),
  not external GitHub Actions — do not add `.github/workflows/openwiki-update.yml`.
- **STUN/TURN** — the client defaults to Google STUN servers; override via
  `rtcConfig`. TLS is `wss://` (set `tls: true` in the client config).

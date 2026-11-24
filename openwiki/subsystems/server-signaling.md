---
type: "Reference"
title: "Go Signaling Server"
openwiki_generated: true
sources:
  - id: openwiki-source-926f5bdf2e4b77b0b06cf4e8
    resource: repo://server/cmd/server.go
  - id: openwiki-source-41f21ee88395963644de9448
    resource: repo://server/pkg/config/config.go
  - id: openwiki-source-0d6410746f8812b1a6d372ba
    resource: repo://server/pkg/config/consts.go
  - id: openwiki-source-fe532a441d6120850e1025f4
    resource: repo://server/pkg/handler/auth.go
  - id: openwiki-source-9ef7bf558ea5a77d41c4fa0b
    resource: repo://server/pkg/handler/claim_hub_for_create.go
  - id: openwiki-source-b539b60065144e2cf7f200e7
    resource: repo://server/pkg/handler/create_hub_by_id.go
  - id: openwiki-source-91c8b5702e75b83f8531a612
    resource: repo://server/pkg/handler/create_static_hub.go
  - id: openwiki-source-e27a23c64f72b7d3d77630c6
    resource: repo://server/pkg/handler/handler.go
  - id: openwiki-source-3c52325a8fc10ab26c610646
    resource: repo://server/pkg/handler/join_hub.go
  - id: openwiki-source-9df2276596bc3c7c9f0676fd
    resource: repo://server/pkg/handler/join_or_create_hub_by_id.go
  - id: openwiki-source-260d31194d7a0cb2a0aa776c
    resource: repo://server/pkg/handler/join_or_create_hub_ip.go
  - id: openwiki-source-bff77f666959548dd6f06610
    resource: repo://server/pkg/handler/join_or_create_upgrade_failure_test.go
  - id: openwiki-source-1eae49f0a1c1e6b3c42e6b07
    resource: repo://server/pkg/handler/migrate.go
  - id: openwiki-source-92ce67688621ba2c2d38e777
    resource: repo://server/pkg/handler/ratelimit.go
  - id: openwiki-source-596cf169341f9612a2d0dea6
    resource: repo://server/pkg/handler/status.go
  - id: openwiki-source-b985a45eeefdba7d9abbac00
    resource: repo://server/pkg/handler/validation.go
  - id: openwiki-source-3fcd30e2964f43d36d37064d
    resource: repo://server/pkg/handler/websocket.go
  - id: openwiki-source-46ad56ef17cb17e8c9ebaae3
    resource: repo://server/pkg/hub/hub_test.go
  - id: openwiki-source-da50555ad2e1dffee0054a4e
    resource: repo://server/pkg/hub/hub.go
  - id: openwiki-source-95e157f67f42c6cf1b6fe738
    resource: repo://server/pkg/storage/gache.go
  - id: openwiki-source-0eb2a9b2acf717d5c99e9894
    resource: repo://server/pkg/zerohub/zerohub.go
generated: { by: "hermes", at: "2026-11-22T15:12:07.899Z" }
verified:
  - by: openwiki/0.6.0
    at: 2026-11-24T15:39:10.546Z
---


# Go Signaling Server

The server is a Go `fasthttp` application that owns the hub/peer state for all
clients and relays signaling protobuf frames between them. It is the only
server-side artifact in the monorepo. Source lives under `server/pkg/` with the
entrypoint in `server/cmd/server.go`.

## Entry & configuration

`server/cmd/server.go` boots the server:

1. `config.LoadConfig()` — reads `.env` (or `ENV_FILE`) via `godotenv` and
   unmarshals environment variables into `Config` via `go-env`. Key vars:
   `APP_ENVIRONMENT` (default `dev`), `APP_HOST` (default `0.0.0.0`),
   `APP_PORT` (default `8080`), `APP_CLIENT_SECRET` (required),
   `APP_HUB_STORAGE` / `APP_PEER_STORAGE` (default `memory`),
   `APP_TRUST_PROXY` (default `false`), and `APP_ALLOWED_ORIGINS` (optional
   comma-separated WebSocket origin allow-list).
2. `logger.InitLogger(cfg)` — configures the global zerolog logger.
3. Constructs **three separate `zerohub.ZeroHub` instances** —
   `zeroHubStatic`, `zeroHubRandom`, `zeroHubIP` — via a shared
   `newZeroHubOrPanic(cfg, name)` constructor that panics on any construction
   failure, so each hub mode has an isolated hub registry and its own
   peer/expiry semantics.
4. `handler.NewHandler(...)` then `Serve()`.

`NewHandler` refuses to start if `APP_CLIENT_SECRET` is empty, because the
admin endpoints would otherwise be open to unauthenticated requests.

## The three hub modes & routing

`handler.Serve` builds a fasthttp server and dispatches on `ctx.Path()`:

| Path | Handler | ZeroHub instance | Notes |
|---|---|---|---|
| `/v1/status` | `Status` | — | health/migration state; 301 + backupHost while migrating |
| `/v1/admin/migrate` | `Migrate` | — | admin auth |
| `/v1/static-hubs/create` | `CreateStaticHub` | static | admin-gated **plain HTTP** (no WebSocket upgrade); never-expires hubs; cross-mode collision-checked |
| `/v1/static-hubs/join` | `JoinHub` | static | |
| `/v1/random-hubs/create` | `CreateHubRandom` | random | server picks a UUID |
| `/v1/random-hubs/get` | `GetHub` | random | metadata only |
| `/v1/random-hubs/join` | `JoinHub` | random | |
| `/v1/ip-hubs/join-or-create` | `JoinOrCreateHubIP` | IP | hub ID = FNV-1a hash of the client IP |
| `/v1/ip-hubs/join` | `JoinHub` | IP | join an existing IP hub by its server-generated numeric id |

Unknown paths return 404; other handler errors return 503 — **except**
`errAdminUnauthorized`, which `CheckAdminAuth` has already rendered as a 401
and which is returned without overwriting the response.

While `isMigrating` is set, WebSocket create/join-or-create requests are
forwarded via `ForwardMigrate` (a 1001 close carrying the backup host), and
plain-HTTP requests (`/v1/static-hubs/create`, `/v1/status`) instead get a 301
with `{"status": "migrating", "backupHost": ...}` (`migrateHTTPResponse`).
A `JoinHub` for a hub that does not exist also forwards to the backup host
while migrating.

## Hub & peer lifecycle

- **`zerohub.ZeroHub`** (pkg/zerohub) is the hub registry. `CreateHubIfAbsent`
  and `GetOrCreateHub` share the atomic `getOrCreateHubLocked` read-then-write
  under a `sync.Mutex`, so concurrent create and join-or-create calls for the
  same ID collapse to a single hub: the race winner stores it,
  `CreateHubIfAbsent` losers get `ErrHubAlreadyExists` (mapped to `409`), and
  `GetOrCreateHub` returns the existing instance plus a `created` flag that
  callers use to decide whether rolling the hub back on a failed upgrade is
  safe. `GetHubById` / `RemoveHubById` wrap the underlying `HubStorage`;
  `HubStore()` exposes the storage so the WebSocket teardown path can hand the
  hub its own storage to `RemovePeerIfLast`.
- **`hub.Hub`** (pkg/hub) owns one hub's peers. `AddPeer` assigns a monotonic
  numeric ID from an `atomic.Uint64` counter, marshals the join signal
  **before** registering the peer in `PeerStorage` (so a marshal failure is a
  no-op — no storage entry, no broadcast, no half-registered peer), rejects
  joins once the hub's `closing` flag is set (a hub being deleted by
  `RemovePeerIfLast` cannot gain a new peer even if the joiner already fetched
  the hub object), then stores the peer under the peer-mutation lock,
  broadcasts the join signal to the other peers, and sends the new peer a
  `HubInfoMessage`. `RemovePeerIfLast(id, hubStorage)` removes the peer and,
  **only when that peer was the last member and the hub is not permanent**,
  deletes the hub from `hubStorage` — the removal, the emptiness check, and
  the hub deletion all happen under the same lock, so a racing join can never
  orphan into a just-deleted room. It is idempotent: a missing peer is a no-op
  with no broadcast. `SendOfferToPeer`, `SendAnswerToPeer`, and
  `SendIceCandidateToPeer` all relay through one shared `sendToPeer`
  lookup-and-send helper. `HandleMessage` is the per-socket read loop; it
  relays offer/answer/ICE-candidate messages and ignores self-targeted sends.

**Hub teardown** happens in two places inside `handler.Upgrade`: the socket's
close handler (`peer.Close()` + `hub.RemovePeerIfLast`), and a fallback right
after `hub.HandleMessage` returns (fires when the read loop exited before the
close handler ran, e.g. a read error). Both paths are safe to race because
`RemovePeerIfLast` is idempotent — the second call sees the missing peer and
broadcasts nothing. A keepalive goroutine pings the peer every
`idleTimeout/4`, closes the socket after `WSIdleTimeout` (60s) of inactivity,
and is joined before the upgrade callback returns so fasthttp can safely
recycle the hijacked connection.

**Upgrade-failure cleanup** plugs an orphaned-hub leak. `Upgrade` reports a
failed connection two ways: a non-nil error — classified by the shared
`wrapUpgradeError` helper, which turns a `websocket.HandshakeError` into a
`websocket handshake` error and everything else into a generic upgrade error
(`ForwardMigrate` routes its upgrade failures through the same helper, so
both upgrade paths report failures identically) — or
`responseWritten=true` (the up-front `peerMetadata` rejection that already
wrote a `400` for malformed JSON or `413` for an oversized value). `AddPeer`
only runs inside the upgrade callback, so whenever `Upgrade` does not fully
succeed, no peer was added for this request and the hub is empty.
`CreateHubByID` and `JoinOrCreateHubByID` therefore route the failure through
the shared `finishUpgradeFailure` epilogue with a rollback that calls
`zh.RemoveHubById` on that hub, so a failed handshake (or a rejected
`peerMetadata`) cannot leave an empty hub squatting in the registry forever —
an unbounded leak on memory storage. `JoinOrCreateHubByID` removes the hub
only when this call created it, because a pre-existing hub may hold live
peers; when `responseWritten` is true the already-written 400/413 is returned
as nil instead of being overwritten by a 500. `JoinHub` never creates a hub
and passes no rollback.

## Cross-mode collision guard

Each hub mode keeps its own `ZeroHub` instance with its own storage and lock,
so a same-mode create is atomic on its own — but a user-chosen ID could still
be claimed concurrently in two different modes, fragmenting the room under
one public ID. Every user-chosen-ID path (`CreateStaticHub`,
`CreateHubByID`, `JoinOrCreateHubByID`) therefore holds
`h.hubIdCrossModeMu` across the shared `claimHubForCreate` /
`claimGetOrCreateHub` helpers, which probe the sibling hub modes' storage and
claim the ID while still under one lock, answering 409 when a sibling already
holds the ID. Generated IDs (random UUID, IP FNV hash) take the lock too, but
their probe always misses and their ID can never collide, so the guard is a
no-op there. The WebSocket upgrade (and any failed-upgrade rollback) happens
**after** the lock is released: the critical section only covers the
hub-identity claim, and the claim stays valid because the stored hub outlives
the lock.

## Pluggable storage

Hubs and peers are each stored behind `storage.Storage[T]`
(pkg/storage), a generic interface (`Add`, `Get`, `GetAll` as
`iter.Seq[T]`, `Delete`, `IsEmpty`). Two backends implement it:
`MemoryStorage` (a mutex-guarded map) and `GacheStorage` (wrapping a
`ntsd/gache/v2` `Gache` instance with the expired hook disabled and the
default TTL overridden to `gache.NoTTL` so entries live until the
application removes them explicitly). `NewZeroHub` and `buildHub` select the
backend per the `APP_HUB_STORAGE` / `APP_PEER_STORAGE` config, erroring on an
unknown value.

## Rate limiting & proxy trust

`Serve` wraps the request handler in an **in-package token-bucket rate
limiter** (`rateLimitMiddleware`, pkg/handler/ratelimit.go) at
**60 requests/minute** with continuous refill; excess requests get a 429.
Keys idle longer than 2 minutes are reclaimed by a sweep that runs at most
every 32s, so the per-key map cannot grow unbounded on a long-running server.
The limiter is keyed by:

- the **socket peer address** (`remoteAddrKey`, IP:port) by default —
  unspoofable, and each TCP connection gets its own DoS budget; or
- the **outermost `X-Forwarded-For` IP** (`forwardedIPKey`) when
  `APP_TRUST_PROXY` is set.

`APP_TRUST_PROXY` must only be enabled behind a reverse proxy that strips or
replaces `X-Forwarded-For`/`X-Real-IP`; otherwise a client could forge the
header to defeat the per-client DoS throttle. The limiter key is
**deliberately different** from the `clientIP()` helper that derives the hub
ID for IP-keyed hubs (`JoinOrCreateHubIP`): `clientIP` drops the port so all
connections from one client IP share one hub — the same-network grouping IP
hubs exist for — whereas the limiter keeps the port so each socket gets its
own budget.

## Input validation & origin checks

Before any WebSocket upgrade the handler rejects malformed query params
with `400`/`413` (once upgraded, no HTTP status can be sent):

- **Hub ID** — the shared `validateHubIdParam` helper runs the ordered id
  checks (empty/whitespace `id` → 400, oversized `id` → 413) on every hub
  endpoint: it is embedded in `validateHubCreateParams` for the
  create/join-or-create paths and called directly by the read/join paths
  (`JoinHub`, `GetHub`). A missing/empty ID is rejected up front instead of
  silently creating or joining a junk hub under the empty-string key. The
  checks are no-ops for server-generated IDs (UUID for random hubs, FNV-1a
  hash for IP hubs).
- **Metadata JSON** — `validJSONQueryParam` rejects a `hubMetadata` /
  `peerMetadata` query param that is not valid JSON; `validMetadataSize`
  answers an oversized `id`/`hubMetadata`/`peerMetadata` with 413 before the
  JSON shape is checked. These values are stored in hub/peer state and
  re-broadcast to every peer, so without a cap (4 KiB, `MaxMetadataSize`) a
  single oversized value is amplified O(N) across the hub.

The upgrader's `CheckOrigin` (`sameOriginOrAllowed`) accepts requests with no
`Origin` header (non-browser clients), any `Origin` whose full value is in
the `APP_ALLOWED_ORIGINS` allow-list — including the `*` wildcard — and
Origins whose host equals the request `Host` (case-insensitively);
unparseable Origins are rejected. Wildcard support is required: ZeroHub is
intentionally operated as a public signaling service so frontend developers
can deploy WebRTC apps from any origin, and it must not be removed until the
official developer portal ships. After the upgrade,
`ws.SetReadLimit(WSMaxFrameSize)` (1 MiB) caps inbound frames — an oversized
frame gets a 1009 close instead of being buffered into memory (OOM DoS).

`/v1/status` is a public, read-only health/migration endpoint, so it answers
with a static `Access-Control-Allow-Origin: *` plus `Vary: Origin` — a
constant, **not** a reflection of the request's `Origin` header (reflecting
an arbitrary origin is the classic CORS anti-pattern and is unnecessary when
the endpoint is open to all origins anyway). The exposed data
(`status` + `backupHost`) is considered public.

## Admin auth & migration

- **Admin auth** (`CheckAdminAuth`, pkg/handler/auth.go): the `Authorization`
  header is base64-decoded and compared against `APP_CLIENT_SECRET` using
  `crypto/subtle.ConstantTimeCompare`, which closes the timing side-channel a
  plain `!=` comparison would leave open. On failure it writes a 401 JSON
  body and returns `errAdminUnauthorized`; callers must treat a non-nil error
  as a hard stop (no state mutation after failure). It guards
  `/v1/admin/migrate` and `/v1/static-hubs/create` (auth runs before the
  migration check so unauthenticated requests get 401, not a WebSocket close
  whose reason is the internal backup host).
- **Zero-downtime migration** (`Migrate` + `ForwardMigrate`): an admin call to
  `/v1/admin/migrate?host=<new>` validates the host with
  `validateBackupHost` (a bare `host` or `host:port` — no scheme, `//`,
  path/query/fragment, userinfo, or out-of-range port; anything else is a
  `400` without touching state, so a typo or an attacker holding
  `APP_CLIENT_SECRET` cannot redirect every client to a garbage or malicious
  host), then sets `backupHost` (under `migrateMu`) and atomically flips
  `isMigrating`. While migrating, WebSocket create/join-or-create requests are
  rejected with `ForwardMigrate`, which upgrades the connection and sends a
  WebSocket *going-away* close (code 1001) whose reason is the backup host;
  the client's `reconnect` reads that reason and reconnects to the new host,
  while existing sessions drain naturally. Plain-HTTP requests instead get a
  301 with the backup host (`migrateHTTPResponse`), because `ForwardMigrate`
  requires a WebSocket handshake and would surface a 503 "websocket
  handshake" to an out-of-band HTTP client. The two fields are kept
  consistent as a unit: `isMigrating` implies `backupHost != ""`.

## Failure behavior

- Per-socket errors in `HandleMessage` are logged and end the read loop; the
  close handler then tears down the peer/hub.
- The fasthttp server enforces `MaxRequestBodySize` (4 KiB) for plain-HTTP
  requests; the WebSocket upgrader applies `HandshakeTimeout` (5s) and
  read/write buffer sizes (4 KiB) from config, caps inbound frames at 1 MiB
  (`WSMaxFrameSize`), and a liveness probe closes half-open signaling
  connections after 60s of silence (see Hub teardown).

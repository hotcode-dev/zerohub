---
type: "Reference"
title: "Go Signaling Server"
openwiki_generated: true
sources:
  - id: openwiki-source-926f5bdf2e4b77b0b06cf4e8
    resource: repo://server/cmd/server.go
  - id: openwiki-source-41f21ee88395963644de9448
    resource: repo://server/pkg/config/config.go
  - id: openwiki-source-fe532a441d6120850e1025f4
    resource: repo://server/pkg/handler/auth.go
  - id: openwiki-source-b539b60065144e2cf7f200e7
    resource: repo://server/pkg/handler/create_hub_by_id.go
  - id: openwiki-source-e27a23c64f72b7d3d77630c6
    resource: repo://server/pkg/handler/handler.go
  - id: openwiki-source-9df2276596bc3c7c9f0676fd
    resource: repo://server/pkg/handler/join_or_create_hub_by_id.go
  - id: openwiki-source-260d31194d7a0cb2a0aa776c
    resource: repo://server/pkg/handler/join_or_create_hub_ip.go
  - id: openwiki-source-1eae49f0a1c1e6b3c42e6b07
    resource: repo://server/pkg/handler/migrate.go
  - id: openwiki-source-92ce67688621ba2c2d38e777
    resource: repo://server/pkg/handler/ratelimit.go
  - id: openwiki-source-596cf169341f9612a2d0dea6
    resource: repo://server/pkg/handler/status.go
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
generated: { by: "hermes", at: "2026-11-20T20:39:20.288Z" }
verified:
  - by: openwiki/0.6.0
    at: 2026-11-20T20:39:20.288Z
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
   `APP_TRUST_PROXY` (default `false`), and `APP_ALLOWED_ORIGINS`
   (optional comma-separated origin allow-list for the WebSocket upgrader).
2. `logger.InitLogger(cfg)` — configures the global zerolog logger.
3. Constructs **three separate `zerohub.ZeroHub` instances** —
   `zeroHubStatic`, `zeroHubRandom`, `zeroHubIP` — via a shared
   `newZeroHubOrPanic(cfg, name)` constructor that panics on any construction
   failure, so each hub mode has an isolated hub registry.
4. `handler.NewHandler(...)` then `Serve()`.

`NewHandler` refuses to start if `APP_CLIENT_SECRET` is empty, because the
admin endpoint would otherwise be open to unauthenticated requests.

## The three hub modes & routing

`handler.Serve` builds a fasthttp server and dispatches on `ctx.Path()`:

| Path | Handler | ZeroHub instance | Notes |
|---|---|---|---|
| `/v1/status` | `Status` | — | health/version, CORS `*` |
| `/v1/admin/migrate` | `Migrate` | — | admin auth |
| `/v1/static-hubs/create` | `CreateStaticHub` | static | admin auth, plain HTTP JSON, 409 if ID exists |
| `/v1/static-hubs/join` | `JoinHub` | static | WebSocket upgrade |
| `/v1/random-hubs/create` | `CreateHubRandom` | random | server picks ID |
| `/v1/random-hubs/get` | `GetHub` | random | plain HTTP JSON |
| `/v1/random-hubs/join` | `JoinHub` | random | WebSocket upgrade |
| `/v1/ip-hubs/join-or-create` | `JoinOrCreateHubIP` | IP | ID derived from caller IP (FNV-1a) |

Unknown paths return 404; other handler errors return 503 — **except**
`errAdminUnauthorized`, which `CheckAdminAuth` has already rendered as a 401
and which is returned without overwriting the response.

Create/join-or-create handlers that are migration-gated first check
`isMigrating.Load()` and, if migrating, call `ForwardMigrate` instead of
creating.

## Hub & peer lifecycle

- **`zerohub.ZeroHub`** (pkg/zerohub) is the hub registry. `CreateHubIfAbsent`
  performs the read-then-write under a `sync.Mutex` so concurrent
  create calls for the same ID collapse to a single hub: the race winner
  creates and the rest receive `ErrHubAlreadyExists` (mapped to `409`),
  instead of orphaning one. `GetOrCreateHub` does the same for
  join-or-create: concurrent calls always return the same hub instance.
  `GetHubById` / `RemoveHubById` wrap the underlying `HubStorage`.
- **`hub.Hub`** (pkg/hub) owns one hub's peers. `AddPeer` assigns a monotonic
  numeric ID from an `atomic.Uint64` counter, marshals the join signal
  **before** registering the peer in `PeerStorage` (so a marshal failure is a
  no-op — no storage entry, no broadcast, no half-registered peer), then
  stores the peer, broadcasts a `PeerJoinedMessage` to other peers, and sends
  the new peer a `HubInfoMessage` (roster excludes the new peer itself). A
  `closing` atomic flag set under the peer-mutation lock prevents a racing
  join from registering into a hub that is being deleted. `RemovePeerIfLast`
  atomically removes the peer and, when it was the last member, deletes the
  hub from `HubStorage` — all under the peer-mutation lock so a concurrent
  `AddPeer` cannot observe a half-empty hub. It is idempotent: a missing peer
  is a no-op. Permanent (never-expire) hubs are never deleted.
  `SendOfferToPeer` / `SendAnswerToPeer` / `SendIceCandidateToPeer` relay
  frames to the target peer via a shared `sendToPeer` helper. `HandleMessage`
  is the per-socket read loop.
- **`peer.Peer`** (pkg/peer) wraps a `fasthttp/websocket` connection plus
  metadata; it is guarded by a `sync.Mutex`. `NewPeer` has no ID until
  `AddPeer` sets one.

**Hub teardown** happens in two places inside `handler.Upgrade`: the socket's
close handler (`peer.Close()` + `RemovePeerIfLast`), and a fallback right after
`hub.HandleMessage` returns (fires only when the read loop exited before the
close handler ran, e.g. a read error or idle-timeout close). Both paths are
safe to race because `RemovePeerIfLast` is idempotent — a missing peer is a
no-op. The upgrade callback also starts a keepalive goroutine that sends
periodic WebSocket pings (interval = idleTimeout / 4) and closes the socket
when `idleTimeout` elapses without a pong, reaping half-open connections.
Inbound frames are capped at `config.WSMaxFrameSize` via `ws.SetReadLimit`.

**Upgrade-failure cleanup** plugs an orphaned-hub leak. `Upgrade` reports a
failed connection two ways: a non-nil error (a real handshake error) or
`responseWritten=true` (the up-front `peerMetadata` size/JSON rejection that
already wrote a 413/400). `AddPeer` only runs inside the upgrade callback, so
whenever `Upgrade` does not fully succeed, no peer was added for this request
and the hub is empty. `CreateHubByID` and `JoinOrCreateHubByID` therefore call
the shared `finishUpgradeFailure` helper with a rollback that removes the hub
via `zh.RemoveHubById`, so a failed handshake (or a rejected `peerMetadata`)
cannot leave an empty hub squatting in the registry. `JoinOrCreateHubByID`
removes the hub only when this call created it (the `created` flag from
`GetOrCreateHub`), because a pre-existing hub may hold live peers; `JoinHub`
never creates a hub and passes a nil rollback. When `responseWritten` is true
the already-written 4xx is not overwritten by a 500.

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
limiter** (`handler/ratelimit.go`, no external dependency) at
**60 requests/minute** per key. The limiter is keyed by:

- the **socket peer address** (`ctx.RemoteAddr()`, IP:port) by default —
  unspoofable; or
- the **outermost `X-Forwarded-For` IP** when `APP_TRUST_PROXY` is set.

Idle keys are swept every 32 seconds after a 2-minute inactivity TTL so the
bucket map cannot grow unbounded. `APP_TRUST_PROXY` must only be enabled behind
a reverse proxy that strips or replaces `X-Forwarded-For`/`X-Real-IP`;
otherwise a client could forge the header to defeat the per-client DoS
throttle. The limiter key (`remoteAddrKey` / `forwardedIPKey`) is
**intentionally different** from `clientIP()` (IP-only, port dropped), which
derives the hub ID for IP-keyed hubs: the limiter keys per-connection
(IP:port), while IP hubs key per-client-IP so all connections from one IP
share a hub.

## Input validation & CORS

Before any WebSocket upgrade the handler rejects malformed query params with
`400` (once upgraded, no HTTP status can be sent):

- **Hub ID** — `validHubId` requires a non-empty, non-whitespace `id`; a
  missing/empty ID is rejected up front with 400 instead of silently creating
  a junk hub under the empty-string key. The check is a no-op for
  server-generated IDs (uuid for random hubs, FNV-1a hash for IP hubs).
- **Size caps** — `validMetadataSize` rejects any `id`, `hubMetadata`, or
  `peerMetadata` query param exceeding `config.MaxMetadataSize` with a 413,
  before the JSON shape is checked (oversized values would otherwise be stored
  and re-broadcast O(N) across the hub).
- **Metadata JSON** — `validJSONQueryParam` rejects a `hubMetadata` /
  `peerMetadata` query param that is not valid JSON with a 400. Malformed
  metadata would otherwise be stored and re-broadcast to every peer, where a
  client that `JSON.parse`s it would crash its message dispatcher.

`/v1/status` is a public, read-only health/migration endpoint, so it answers
with a static `Access-Control-Allow-Origin: *` plus `Vary: Origin` — a
constant, **not** a reflection of the request's `Origin` header (reflecting
an arbitrary origin is the classic CORS anti-pattern and is unnecessary when
the endpoint is open to all origins anyway). The exposed data
(`status` + `backupHost`) is considered public.

## Admin auth & migration

- **Admin auth** (`CheckAdminAuth`): the `Authorization` header is
  base64-decoded and compared against `APP_CLIENT_SECRET` using
  `crypto/subtle.ConstantTimeCompare`, which closes the timing side-channel a
  plain `!=` comparison would leave open. On failure it writes a 401 JSON
  body and returns `errAdminUnauthorized`; callers must treat a non-nil error
  as a hard stop (no state mutation after failure). It guards
  `/v1/admin/migrate` and `/v1/static-hubs/create`.
- **Zero-downtime migration** (`Migrate` + `ForwardMigrate`): an admin call to
  `/v1/admin/migrate?host=<new>` validates the host with
  `validateBackupHost` (a bare `host` or `host:port` — no scheme, `//`,
  path/query/fragment, userinfo, or out-of-range port; anything else is a
  `400` without touching state, so a typo or an attacker holding
  `APP_CLIENT_SECRET` cannot redirect every client to a garbage or malicious
  host), then sets `backupHost` (under `migrateMu`) and atomically flips
  `isMigrating`. While migrating, WebSocket create/join-or-create requests are
  rejected with `ForwardMigrate`, which upgrades the connection and sends a
  WebSocket *going-away* close (code 1001) whose reason is the backup host.
  The client's `reconnect` reads that reason and reconnects to the new host;
  existing sessions drain naturally. Plain-HTTP endpoints (`GetHub`,
  `CreateStaticHub`) instead answer a 301 with the backup host via
  `migrateHTTPResponse` (an upgrade attempt would surface a 503 to a
  non-WebSocket client). The two fields are kept consistent as a
  unit: `isMigrating` implies `backupHost != ""`.

## Failure behavior

- Per-socket errors in `HandleMessage` are logged and end the read loop; the
  close handler or post-loop fallback then tears down the peer via
  `RemovePeerIfLast`.
- The fasthttp server enforces `MaxRequestBodySize` and the WebSocket upgrader
  applies `HandshakeTimeout`, read/write buffer sizes, and a per-frame
  `SetReadLimit` (`config.WSMaxFrameSize`) that caps inbound binary frames to
  prevent OOM from a single oversized frame.
- The upgrader's `CheckOrigin` uses `sameOriginOrAllowed`: requests with no
  Origin (non-browser clients) or whose Origin host matches the request Host
  are always accepted; additionally, any origin listed in the
  comma-separated `APP_ALLOWED_ORIGINS` env var is allowed, and a wildcard
  `*` in that list accepts all origins (ZeroHub is intentionally operated as
  a public signaling server).

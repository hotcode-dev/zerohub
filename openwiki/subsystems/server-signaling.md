---
type: "Reference"
title: "Go Signaling Server"
openwiki_generated: true
sources:
  - id: openwiki-source-926f5bdf2e4b77b0b06cf4e8
    resource: repo://server/cmd/server.go
  - id: openwiki-source-41f21ee88395963644de9448
    resource: repo://server/pkg/config/config.go
  - id: openwiki-source-e27a23c64f72b7d3d77630c6
    resource: repo://server/pkg/handler/handler.go
  - id: openwiki-source-1eae49f0a1c1e6b3c42e6b07
    resource: repo://server/pkg/handler/migrate.go
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
generated: { by: "hermes", at: "2026-10-10T01:28:37.861Z" }
verified:
  - by: openwiki/0.6.0
    at: 2026-10-10T01:28:37.861Z
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
   `APP_PORT` (default `8080`), `APP_DOMAIN` (default `localhost`),
   `APP_CLIENT_SECRET` (required), `APP_HUB_STORAGE` / `APP_PEER_STORAGE`
   (default `memory`), and `APP_TRUST_PROXY` (default `false`).
2. `logger.InitLogger(cfg)` — configures the global zerolog logger.
3. Constructs **four separate `zerohub.ZeroHub` instances** — `zeroHub`
   (static), `zeroHubRandom`, `zeroHubIP`, `zeroHubPermanent` — so each hub
   type has an isolated hub registry and its own peer/expiry semantics.
4. `handler.NewHandler(...)` then `Serve()`.

`NewHandler` refuses to start if `APP_CLIENT_SECRET` is empty, because the
admin endpoint would otherwise be open to unauthenticated requests.

## The four hub types & routing

`handler.Serve` builds a fasthttp server and dispatches on `ctx.Path()`:

| Path | Handler | ZeroHub instance | Notes |
|---|---|---|---|
| `/v1/status` | `Status` | — | health/version |
| `/v1/admin/migrate` | `Migrate` | — | admin auth |
| `/v1/hubs/create` | `CreateHubStatic` | static | 409 if ID exists |
| `/v1/hubs/get` | `GetHub` | static | 404 if missing |
| `/v1/hubs/join` | `JoinHub` | static | |
| `/v1/hubs/join-or-create` | `JoinOrCreateHubStatic` | static | |
| `/v1/random-hubs/create` | `CreateHubRandom` | random | server picks ID |
| `/v1/random-hubs/get` | `GetHub` | random | |
| `/v1/random-hubs/join` | `JoinHub` | random | |
| `/v1/ip-hubs/join-or-create` | `JoinOrCreateHubIP` | IP | ID from client IP |
| `/v1/ip-hubs/join` | `JoinHub` | IP | |
| `/v1/permanent-hubs/join` | `JoinHub` | permanent | |
| `/v1/permanent-hubs/create` | `CreateHubPermanent` | permanent | admin auth |

Unknown paths return 404; other handler errors return 503 — **except**
`errAdminUnauthorized`, which `CheckAdminAuth` has already rendered as a 401
and which is returned without overwriting the response.

Create/join-or-create handlers that are migration-gated first check
`isMigrating.Load()` and, if migrating, call `ForwardMigrate` instead of
creating.

## Hub & peer lifecycle

- **`zerohub.ZeroHub`** (pkg/zerohub) is the hub registry. `GetOrCreateHub`
  performs the read-then-write under a `sync.Mutex` so concurrent
  join-or-create calls for the same ID collapse to a single hub rather than
  orphaning one. `NewHub`/`GetHubById`/`RemoveHubById` wrap the underlying
  `HubStorage`.
- **`hub.Hub`** (pkg/hub) owns one hub's peers. `AddPeer` assigns a monotonic
  numeric ID from an `atomic.Uint64` counter, stores the peer in `PeerStorage`,
  broadcasts a `PeerJoinedMessage` to other peers, and sends the new peer a
  `HubInfoMessage`. `RemovePeerById` is **idempotent**: it first checks the
  peer exists in `PeerStorage` and returns `false` without broadcasting
  anything when it is missing, so a duplicate removal cannot double-send the
  `PeerDisconnectedMessage` or double-trigger hub removal. For a present peer
  it deletes the peer, broadcasts a `PeerDisconnectedMessage`, and returns
  `true` when the hub is now empty (unless the hub is permanent).
  `SendOfferToPeer` / `SendAnswerToPeer` relay SDP to the target peer.
  `HandleMessage` is the per-socket read loop.
- **`peer.Peer`** (pkg/peer) wraps a `fasthttp/websocket` connection plus
  metadata; it is guarded by a `sync.Mutex`. `NewPeer` has no ID until
  `AddPeer` sets one.

**Hub teardown** happens in two places inside `handler.Upgrade`: the socket's
close handler (`peer.Close()` + `RemovePeerById` → `zh.RemoveHubById` when the
hub empties), and a fallback right after `hub.HandleMessage` returns (fires
only when the read loop exited before the close handler ran, e.g. a read
error). Both paths are safe to race because `RemovePeerById` is idempotent —
the second call sees the missing peer, broadcasts nothing, and returns
`false`. Permanent hubs never expire.

## Pluggable storage

Hubs and peers are each stored behind `storage.Storage[T]`
(pkg/storage), a generic interface (`Add`, `Get`, `GetAll` as
`iter.Seq[T]`, `Update`, `Delete`, `IsEmpty`). Two backends implement it:
`MemoryStorage` (a mutex-guarded map) and `GacheStorage` (wrapping a
`ntsd/gache/v2` `Gache` instance with the expired hook disabled). `NewZeroHub` and `buildHub` select the backend per the
`APP_HUB_STORAGE` / `APP_PEER_STORAGE` config, erroring on an unknown value.

## Rate limiting & proxy trust

`Serve` wraps the request handler in a `ulule/limiter/v3` fasthttp middleware
at **60 requests/minute**. The limiter is keyed by:

- the **socket peer address** (`ctx.RemoteAddr()`) by default — unspoofable; or
- the **outermost `X-Forwarded-For` IP** when `APP_TRUST_PROXY` is set.

`APP_TRUST_PROXY` must only be enabled behind a reverse proxy that strips or
replaces `X-Forwarded-For`/`X-Real-IP`; otherwise a client could forge the
header to defeat the per-client DoS throttle. The key getter and the
limiter's own IP parsing must agree (see `remoteAddrKey` /
`forwardedIPKey` / `ipFromForwardedHeader`).

## Admin auth & migration

- **Admin auth** (`CheckAdminAuth`): the `Authorization` header is
  base64-decoded and compared against `APP_CLIENT_SECRET`. On failure it writes
  a 401 JSON body and returns `errAdminUnauthorized`; callers must treat a
  non-nil error as a hard stop (no state mutation after failure). It guards
  `/v1/admin/migrate` and `/v1/permanent-hubs/create`.
- **Zero-downtime migration** (`Migrate` + `ForwardMigrate`): an admin call to
  `/v1/admin/migrate?host=<new>` sets `backupHost` (under `migrateMu`) and then
  atomically flips `isMigrating`. While migrating, create/join-or-create
  requests are rejected with `ForwardMigrate`, which upgrades the connection
  and sends a WebSocket *going-away* close (code 1001) whose reason is the
  backup host. The client's `reconnect` reads that reason and reconnects to
  the new host; existing sessions drain naturally. The two fields are kept
  consistent as a unit: `isMigrating` implies `backupHost != ""`.

## Failure behavior

- Per-socket errors in `HandleMessage` are logged and end the read loop; the
  close handler then tears down the peer/hub.
- The fasthttp server enforces `MaxRequestBodySize` and the WebSocket upgrader
  applies `HandshakeTimeout` and read/write buffer sizes from
  `config` consts.
- The upgrader's `CheckOrigin` accepts all origins (`return true`).

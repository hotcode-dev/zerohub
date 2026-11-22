---
type: subsystem
title: TypeScript Client SDK
description: The @zero-hub/client SDK — ZeroHubClient connection lifecycle, reconnection with host failover, migration-redirect handling, manual offer/answer handling, disconnect/reuse semantics, the pluggable topology system, data/media channel configuration, and SDP send/receive.
tags: [typescript, client, sdk, webrtc, topology, reconnection, data-channel]
sources:
  - id: openwiki-source-df0d81c76704b851d02513e1
    resource: repo://client/src/const.ts
  - id: openwiki-source-22df8f9ebcff0eeb4e4ed38f
    resource: repo://client/src/topology/meshTopology.ts
  - id: openwiki-source-8e8ffb33fc4935471d3aa9c5
    resource: repo://client/src/topology/peerSetup.ts
  - id: openwiki-source-bd409d9bd601f67e5d47a03d
    resource: repo://client/src/topology/sfuTopology.ts
  - id: openwiki-source-789a383133ee54e1b441a8df
    resource: repo://client/src/utils.ts
  - id: openwiki-source-718b618612c033c4f36b3a45
    resource: repo://client/src/zeroHub.ts
generated: { by: "hermes", at: "2026-11-22T02:25:29.470Z" }
verified:
  - by: openwiki/0.6.0
    at: 2026-11-22T02:25:29.470Z
---

# TypeScript Client SDK

`@zero-hub/client` is the browser/Node SDK. It opens the WebSocket to the
signaling server, drives SDP offer/answer negotiation, and hands the resulting
`RTCPeerConnection`s to a pluggable topology. Public surface is re-exported from
`client/src/index.ts`: `Peer`, `ZeroHubClient`, the config consts/types, and the
`topology` module. The class is generic over `PeerMetadata` and `HubMetadata`.

## ZeroHubClient: state & entrypoints

`ZeroHubClient` (client/src/zeroHub.ts) owns:

- `hosts: string[]`, `hostIndex`, `host` — the failover list of signaling
  hosts (without protocol). The first host is tried first.
- `config` — merged from `DEFAULT_CONFIG` plus user overrides.
- `peers: { [id]: Peer }` — the live peer map.
- `myPeerId`, `hubInfo` — set when the `HubInfoMessage` arrives.
- `topology` — the connection strategy (default `MeshTopology`).
- `ws` — the active WebSocket (binary `arraybuffer` frames).
- `isDisconnected` — manual-disconnect flag.
- `iceTimeouts` — per-peer pending ICE candidate timers; `webRtcRecoveryTimeouts`
  — per-peer pending P2P-drop recovery timers.
- Reconnect state: `reconnectAttempts` / `reconnectTimer` (same-host retry
  budget and queued timer), `reconnectRound` (wraparound sweep counter),
  `isInitialConnection`, `inConfiguredHosts`, `reconnectAbandoned` (terminal
  latch set when every host is exhausted; cleared by a new entry-point call).
- Callbacks: `onZeroHubError`, `onHubInfo`, `onPeerStatusChange`, `onPeerError`,
  `onOffer`, `onAnswer`.
- `logger` — a `ZeroHubLogger` honoring `logLevel`.

The constructor validates that at least one host is supplied, merges the RTC
config and offer options (over `DEFAULT_RTC_CONFIG` /
`DEFAULT_RTC_OFFER_OPTIONS`), and calls `topology.init(this)`. No network
connection is made until an entrypoint is called.

All connection entrypoints funnel into the private
`openHubConnection(path, hubId?, peerMetadata?, hubMetadata?)` helper, which
builds a `URL` from
`getWS(host, tls)` (client/src/utils.ts — `wss://` when `tls`, else `ws://`)
with `id`, `hubMetadata`, `peerMetadata` as query params, and calls
`connectToZeroHub(url)`:

| Method | Path | Purpose |
|---|---|---|
| `createRandomHub(peerMetadata?, hubMetadata?)` | `/v1/random-hubs/create` | create a random hub with a server-minted uuid |
| `joinRandomHub(hubId, peerMetadata?)` | `/v1/random-hubs/join` | join an existing random hub by id |
| `joinStaticHub(hubId, peerMetadata?)` | `/v1/static-hubs/join` | join a static (never-expires, named) hub; creation is an admin-gated plain-HTTP endpoint (`/v1/static-hubs/create`) deliberately NOT exposed on the SDK, because the browser WebSocket API cannot send the `Authorization` header |
| `joinOrCreateIPHub(peerMetadata?, hubMetadata?)` | `/v1/ip-hubs/join-or-create` | IP-keyed join-or-create; the hub id is derived by the server from the caller's IP |
| `joinIPHub(hubId, peerMetadata?)` | `/v1/ip-hubs/join` | join an existing IP-keyed hub by its derived id (the id published in `hubInfo` after a peer created the hub via `joinOrCreateIPHub`) |

All entry points return `Promise<void>` — they resolve when the signaling
WebSocket opens and reject when the connection attempt fails. The older
`createHub`/`joinHub`/`joinOrCreateHub` (named-hub) and
`createPermanentHub`/`joinPermanentHub` entry points no longer exist: named
hubs are now "static hubs" and creating one is not a client-side operation
(browser WebSocket clients cannot carry the admin `Authorization` header).
`joinIPHub(hubId)` joins an existing IP-keyed hub by its derived id — the id
the server minted from the peer that first created the hub via
`joinOrCreateIPHub`, published to that peer in `hubInfo`.

## WebSocket lifecycle & message dispatch

`connectToZeroHub(url)` returns a `Promise<void>` that resolves when the
WebSocket opens and rejects on a connection `error` or an abnormal `close`:

- **Resets state** for reuse: sets `isDisconnected = false`, cancels any
  queued same-host retry timer, and clears the `reconnectAbandoned` latch, so
  a client that previously called `disconnect()` — or whose reconnection was
  exhausted — can be reused cleanly.
- **Tears down a leaked socket**: calls `closeActiveSocket()` to close any
  socket left open by a previous entry-point call that did not go through
  `disconnect()`, nulling all handlers before `close(1000)` so the replaced
  socket does not fire `reconnect()` (which would advance `hostIndex` a second
  time for a single logical failure) or `onZeroHubError`.
- Opens `new WebSocket(url)` with `binaryType = "arraybuffer"`.
- `onmessage` — decodes the frame with `ServerMessage.decode(...)` and routes
  it through `handleZeroHubMessage`. A corrupt frame or a throwing dispatcher
  callback is caught, logged, and surfaced via the isolated `onZeroHubError`
  path instead of escaping the handler and wedging the receive loop.
- `onerror` — logs and fires `onZeroHubError` (via `reportZeroHubError`, which
  isolates a throwing user handler), then rejects the connect Promise for a
  dial that failed before it ever opened. It does **not** reconnect: per RFC
  6455 a network failure fires `error` and then `close` with code 1006, and
  reconnecting in both would advance `hostIndex` twice for a single failure.
  All reconnection happens in `onclose`.
- `onclose` — interprets the close code: `1000` (normal) does nothing;
  `1001` (going away) hands the close *reason* to `reconnect(url, reason)` as
  the migration redirect — which validates the reason as a well-formed host
  before acting on it (see Reconnection below); `1006`/`1011` (abnormal /
  internal error) and `1012`/`1013` (service restart / try again later —
  transient outages, not protocol failures) reconnect without settling the
  Promise (the auto-reconnect path owns the outcome); any other code is a
  protocol-level failure that fires `onZeroHubError` **and** rejects the
  connect Promise.

`handleZeroHubMessage` branches on the `ServerMessage` oneof:

- `hubInfoMessage` — sets `myPeerId`/`hubInfo` (hub metadata is parsed through
  `safeParseJson`, so a malformed value falls back to `{}` instead of crashing
  the dispatcher), fires `onHubInfo`, and **reconciles the peer roster**
  against the authoritative roster carried in the message: adds any roster
  peer not yet in the map (via `addPeer`), and prunes any peer we still hold
  that is no longer listed (and is not ourselves) via `removePeer`, firing
  `ZeroHubDisconnected` first. The prune pass is the auto-reconnect fix —
  a peer that left the hub while the socket was down is never told via
  `peerDisconnectedMessage` (broadcast only while connected), so without it
  that stale `Peer` (with a live, unclosed `RTCPeerConnection`) would leak
  forever.
- `offerMessage` — moves that peer to `AnswerPending` and, when `autoAnswer`,
  calls `sendAnswer`. When `autoAnswer` is `false`, the incoming offer is
  surfaced through the `onOffer(peer, offerSdp)` callback instead (guarded on
  the peer still existing in the map, so a dangling offer for a torn-down peer
  is not surfaced), and the application completes the exchange by calling
  `sendAnswer(peer.id, offerSdp)`.
- `answerMessage` — moves the peer to `AcceptPending` and, when
  `autoAcceptAnswer`, calls `acceptAnswer`. When `autoAcceptAnswer` is
  `false`, the incoming answer is surfaced through the
  `onAnswer(peer, answerSdp)` callback instead (same peer-exists guard), and
  the application calls `acceptAnswer(peer.id, answerSdp)`.
- `peerJoinedMessage` — creates a `Peer` for the joiner (if new, via
  `addPeer`).
- `peerDisconnectedMessage` — fires the `ZeroHubDisconnected` status, then
  tears the peer down through the shared `removePeer` helper.

### Shared peer lifecycle helpers

Peer creation and teardown are centralised so the several code paths that
add or remove a peer can never diverge:

- **`addPeer(peerId, metadata, joinTime)`** — builds a `Peer` with a fresh
  `RTCPeerConnection`, parses its metadata via `safeParseJson`, wires
  `onconnectionstatechange` (marks `Connected` on `connected`; schedules P2P-drop
  recovery on `disconnected`) and `oniceconnectionstatechange` (schedules P2P-drop
  recovery on `failed`), stores it in the map, and marks it `Pending`. Used by
  both the `hubInfoMessage` and `peerJoinedMessage` paths.
- **`removePeer(peerId)`** — clears the peer's pending ICE-candidate and
  P2P-drop recovery timers, closes the peer's `RTCPeerConnection`, nulls the
  two state handlers so a stale ICE event cannot call `restartIce()` on a
  closing connection, and deletes the peer from the map. No-op if already
  gone. Used by `disconnect()`, the `peerDisconnectedMessage` broadcast, and
  the `hubInfoMessage` roster-prune pass. The caller emits the appropriate
  status first (it differs per path).
- **`guardCallback(label, logger, fn)`** — the shared user-callback isolation
  helper in `client/src/utils.ts`: every user-supplied callback
  (`onPeerStatusChange`, `onPeerError`, `onHubInfo`, `onOffer`, `onAnswer`,
  `onZeroHubError`, and the topology's `onPeerStatusChange`) is invoked
  through it in `zeroHub.ts`, so a throwing handler is isolated into an error
  log instead of aborting the signaling dispatch that invoked it. The
  user-facing `onDataChannel`/`onTrack` callbacks in `peerSetup.ts` are
  isolated the same way through the same shared `guardCallback` helper.

P2P-drop recovery: when a live peer's `RTCPeerConnection` reports
`disconnected`/`failed` while the signaling socket is still up,
`scheduleWebrtcRecovery` defers a re-negotiation (`WEBRTC_RECOVERY_DELAY_MS`,
default 500 ms, so a naturally recovering connection wins the race) and the
topology layer re-offers for that peer — this is what restores a P2P link
after a network blip instead of leaving the data/media channel silent forever.

`safeParseJson(raw, fallback)` (module-level helper) `JSON.parse`s the raw
metadata string and returns the parsed value on success, or `fallback` when
the input is missing or malformed. The client's private wrapper warns only on
a genuine parse failure — never on a successful parse, since a valid value
can legitimately equal the fallback — so a corrupt hub/peer metadata value
from the server degrades to the fallback instead of crashing the WebSocket
message dispatcher.

## Reconnection with host failover

`reconnect(currentURL, newHost?)` runs when an abnormal close occurs (from
`onclose`). It is driven by two budgets, both in `DEFAULT_CONFIG`:
`maxReconnectAttempts` (default 10) same-host re-dials and `maxReconnectRounds`
(default 2) full sweeps over the configured host list, with exponential backoff
starting at `reconnectBaseBackoffMs` (default 250 ms, doubling per attempt via
`reconnectBackoffDelayMs`).

- Returns immediately if `isDisconnected` is set (manual disconnect) or if the
  `reconnectAbandoned` latch is set (the terminal "all hosts exhausted" error
  already fired — a later abnormal close on a leftover socket must be a no-op,
  not a re-fire or re-dial; only a fresh entry-point call clears the latch).
- **Migration redirect (`newHost` supplied):** the 1001 close *reason* is first
  validated as a well-formed host by `isWellFormedHost` (client/src/utils.ts —
  a bare hostname or `host:port`, no scheme/path/userinfo, port 0..65535; it
  mirrors the server's `validateBackupHost` and deliberately accepts the
  non-canonical-but-valid spellings the server emits — uppercase hostnames,
  uppercase IPv6 literals, zero-padded ports/octets). Because `1001` is a
  generic RFC 6455 code, a proxy or load balancer may close with a
  human-readable reason: a malformed reason logs a warning and falls through to
  the automatic host-failover path **without touching host state**. A redirect
  back to the current host (`newHost === this.host`, e.g. an operator pointing
  `/admin/migrate` at the current host) is surfaced through `onZeroHubError`
  and stopped, since it would cycle forever with no backoff and no terminal
  error. A valid redirect updates `this.host`, points `hostIndex` at the
  redirected host when it is in the configured list (tracking
  `inConfiguredHosts`), resets the same-host retry budget and the sweep round,
  clears the initial-connection phase, and re-dials.
- **Same-host retry:** on a normal abnormal close (no redirect), if the client
  has already confirmed a connection at some point (`!isInitialConnection`) and
  the current host still has retry budget (`reconnectAttempts < maxAttempts`),
  it re-dials the *same* host on a backoff timer (`scheduleSameHostReconnect`).
  Same-host retries leave `hostIndex` untouched, preserving the "a single
  logical failure advances `hostIndex` exactly once" invariant pinned by
  `test/tests/multihosts.spec.ts`. The initial connection (`isInitialConnection`)
  skips same-host retry and fails over immediately.
- **Host failover:** when the current host's budget is spent and it is not the
  last configured host, `hostIndex` advances to the next configured host, which
  gets a fresh retry budget.
- **Wraparound:** when the last configured host's (or a redirected out-of-list
  host's) budget is spent and `reconnectRound < maxRounds`, the sweep wraps back
  to the first configured host instead of giving up after one pass, so a
  transient outage that partially clears mid-sweep recovers. Each host in the
  next pass gets a fresh budget; the round advances so the terminal error stays
  reachable.
- **Terminal:** when every host's budget is spent on every allowed sweep, the
  `reconnectAbandoned` latch is set and the terminal failure
  (`ALL_HOSTS_EXHAUSTED_ERROR_MESSAGE` = "all ZeroHub hosts are not working,
  please check the ZeroHub hosts") is surfaced through `onZeroHubError` with no
  further automatic retry.

## Disconnect & reuse

`disconnect()`:

1. Sets `isDisconnected = true`.
2. Cancels any queued same-host retry timer and resets the sweep round
   (`clearReconnectRetryState()` + `reconnectRound = 0`), clears all pending
   `iceTimeouts`, and clears all pending `webRtcRecoveryTimeouts`, so no timer
   can fire after teardown and dial a stray socket or re-negotiate a dead peer.
   (`isInitialConnection` is deliberately *not* reset: a reused client has
   already connected once, so a later dial failure is treated as a reconnect,
   not an initial failover.)
3. Calls the shared `closeActiveSocket()` helper, which detaches all WebSocket
   handlers (`onclose`/`onerror`/`onmessage`/`onopen`) so the close does
   **not** trigger auto-reconnect, then closes the socket with code 1000.
   (The same helper is used by `connectToZeroHub` to replace a socket left
   open by a previous connection entry point.)
4. Transitions every peer to `Disconnected` and tears it down via `removePeer`,
   which closes each `RTCPeerConnection`, clears its timers, nulls its state
   handlers so a stale ICE event can't call `restartIce()`, and empties the
   `peers` map.

The client is **reusable** after `disconnect()`: calling any entrypoint again
resets `isDisconnected` and starts a fresh connection. `sendZeroHubMessage`
throws if called while disconnected, when no socket exists, or when the socket
is present but not yet `OPEN` (a `CONNECTING`/`CLOSING` socket) — without that
last guard `ws.send()` would throw a raw `InvalidStateError` that could escape
the calling event handler.

## SDP send/receive

- `sendOffer(peerId, ...)` — runs `createOffer`/`setLocalDescription`, then
  delegates the ICE-candidate wait-and-send to the shared
  `armSendOnIceReady` helper (below). Transitions the peer to `Offering`.
  Offer options are **spread into a fresh local object**
  (`{ ...config.rtcOfferOptions, ...rtcOfferOptions }`) rather than
  `Object.assign`-ed onto the shared config, so per-call options can never
  leak into the stored `config.rtcOfferOptions`.
- `sendAnswer(peerId, offerSdp, ...)` — sets the remote offer description,
  creates the answer, and delegates to the same `armSendOnIceReady` helper.
  Transitions to `Answering`.
- `acceptAnswer(peerId, answerSdp)` — sets the remote answer description.
- `sendOfferToWebsocket` / `sendAnswerToWebsocket` — wrap the SDP in a
  `ClientMessage` and send it; they also advance the peer status.

`sendOffer` and `sendAnswer` both delegate to the private shared helper
`negotiateWithPeer`, which validates the socket, merges per-call options into a
fresh local object, applies any `rtcConfig`, runs the exchange (create + set
local description for an offer; set remote offer + create answer + set local
for an answer), reports + re-throws exchange failures through `onPeerError`,
and arms the ICE-candidate wait-and-send. Because options are **spread into a
fresh local object** (`{ ...config.rtcOfferOptions, ...rtcOfferOptions }`)
rather than mutated on the shared config, per-call options can never leak into
the stored `config.rtcOfferOptions`.

`armSendOnIceReady(peerId, rtcConn, sendOnce)` (private, shared by `sendOffer`
and `sendAnswer`) wires the peer's `onicecandidate` handler plus a
`waitIceCandidatesTimeout` fallback so the SDP `sendOnce` is invoked **exactly
once** while ICE candidates keep trickling:

- Every `onicecandidate` event that carries a candidate is forwarded to the
  signaling socket via `sendIceCandidateToWebsocket` (trickle ICE — including
  candidates that arrive after the SDP has gone out), and the first such event
  also flushes the SDP. The candidate-less event (gathering complete) fires the
  SDP send if it has not gone out yet.
- A `setTimeout` of `waitIceCandidatesTimeout` (default 2000 ms) fires as a
  fallback: if no candidate event has arrived, it flushes the current SDP
  anyway so negotiation is not blocked forever.
- All three paths share a single `isSent` guard, so the SDP itself is sent
  exactly once even if a candidate event and the timer race; candidates
  continue trickling independently afterward.
- Re-arm clears the prior pending handle for `peerId` (so `disconnect()` cannot
  miss it) and records the timer in `this.iceTimeouts[peerId]`; all handles are
  cleared on `disconnect()` / `removePeer()`.

## Manual offer/answer handling

The `autoAnswer` / `autoAcceptAnswer` config flags (both default `true`)
switch the exchange from automatic to application-driven, documented in
`client/README.md`:

- `autoAnswer: false` — the `offerMessage` branch no longer calls
  `sendAnswer`; instead it invokes the public `onOffer(peer, offerSdp)`
  callback (after the peer has moved to `AnswerPending`, and only while the
  peer still exists in the map). The application completes the exchange with
  `sendAnswer(peer.id, offerSdp)`.
- `autoAcceptAnswer: false` — the `answerMessage` branch no longer calls
  `acceptAnswer`; instead it invokes the public `onAnswer(peer, answerSdp)`
  callback (after `AcceptPending`). The application completes the exchange
  with `acceptAnswer(peer.id, answerSdp)`.

Both callbacks are public fields on `ZeroHubClient`, so applications can
inspect/modify the SDP before completing the exchange.

## Topology system

The `Topology` interface (client/src/topology/topology.ts) has `init(zeroHub)`
and `onPeerStatusChange(peer)`. The `ZeroHubClient` calls
`topology.onPeerStatusChange` on every status update (before user callbacks).
Two built-ins:

- **`MeshTopology`** (default) — full mesh. On `Pending`, it sets up data
  channels and media via the shared helpers, then sends the offer **only if
  it is the offerer** (`parseInt(peer.id) > parseInt(myPeerId)`). On
  `WebRTCDisconnected` (P2P drop with the signaling socket still alive), the
  offerer re-sends an offer over the existing `RTCPeerConnection` — the
  renegotiation refreshes the ICE/DTLS transport while the established data
  channels and transceivers persist, so no duplicate channels or tracks are
  created.
- **`SFUTopology`** — routes all P2P traffic through a single SFU peer (the
  numerically lowest peer ID by default, or an explicitly set one — peer IDs
  are sequential decimal strings, so election sorts `parseInt(id, 10)` rather
  than lexicographically, or "10" would beat "2"). The SFU offers to every
  client; non-SFU peers only connect to the SFU, so bandwidth scales better
  for larger groups at the cost of a single point of failure. When the
  implicitly-elected SFU leaves the hub, the topology **re-elects** the
  numerically lowest *remaining* peer and rebuilds the star around it
  (`reElectSfu`); the `lastElectingSfuId` dedup guard makes duplicate or
  delayed departure events for the same departed peer no-ops instead of
  running a second election. An explicitly configured SFU
  (`new SFUTopology(id)`) is never re-elected — it logs a warning and waits
  instead. P2P drops follow the same pattern: only the SFU side re-offers to
  the dropped client.

Both topologies delegate the per-peer WebRTC wiring to the shared helpers in
`client/src/topology/peerSetup.ts` — `setupDataChannel` (offerer creates
`numberOfChannels` channels labeled `"0"`, `"1"`, ...; answerer wires
`ondatachannel`) and `setupMediaChannel` (adds `localStream` tracks, wires
`ontrack`) — with optional log callbacks so each topology keeps its own
logging. The media helper requires call sites to pass the level-gated
`ZeroHubClient.logger`, not the raw user `config.logger`.

Both topologies treat `ZeroHubDisconnected` and `Disconnected` as no-ops.

## Data & media channels

- **Data channels** — `dataChannelConfig` (`numberOfChannels`,
  `rtcDataChannelInit`, `onDataChannel`). Multiple channels per peer support
  separating priority/ordered vs unordered streams. The `onDataChannel`
  callback receives `(peer, dataChannel, isOwnerDataChannel)`; use
  `dataChannel.label` to distinguish channels.
- **Media channels** — `mediaChannelConfig` (`localStream`, `onTrack`).
  When `localStream` is present the topology adds its tracks to each peer
  connection, and `onTrack` fires for incoming remote tracks.

## Configuration (client/src/const.ts + types.ts)

`DEFAULT_CONFIG` sets: `tls: true`, `logLevel: Warning`, `logger: console`,
`waitIceCandidatesTimeout: 2000`, `autoAnswer: true`, `autoAcceptAnswer: true`,
`maxReconnectAttempts: 10`, `maxReconnectRounds: 2`, `reconnectBaseBackoffMs: 250`,
and `rtcConfig` = Google STUN servers + `bundlePolicy: "balanced"`. All are
overridable via the `Config` interface. `LogLevel` is `Debug | Warning | Error
| None`.

## Peer

`Peer` (client/src/peer.ts) is a thin value: `id`, `status` (`PeerStatus`),
`metadata`, `joinTime`, and the `rtcConn: RTCPeerConnection`. `close()` closes
the WebRTC connection and is safe to call repeatedly.

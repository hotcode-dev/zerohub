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
generated: { by: "hermes", at: "2026-11-20T20:39:20.288Z" }
verified:
  - by: openwiki/0.6.0
    at: 2026-11-20T20:39:20.288Z
---

# TypeScript Client SDK

`@zero-hub/client` is the browser/Node SDK. It opens the WebSocket to the
signaling server, drives SDP offer/answer negotiation, and hands the resulting
`RTCPeerConnection`s to a pluggable topology. Public surface is re-exported from
`client/src/index.ts`: `Peer`, `ZeroHubClient`, the `Logger` /
`ZeroHubLogger` types, the config consts/types, and the `topology`
module. The class is generic over `PeerMetadata` and `HubMetadata`.

## ZeroHubClient: state & entrypoints

`ZeroHubClient` (client/src/zeroHub.ts) owns:

- `hosts: string[]`, `hostIndex`, `host` — the failover list of signaling
  hosts (without protocol). The first host is tried first.
- `config` — merged from `DEFAULT_CONFIG` plus user overrides.
- `peers: { [id]: Peer }` — the live peer map.
- `myPeerId`, `hubInfo` — set when the `HubInfoMessage` arrives.
- `topology` — the connection strategy (default `MeshTopology`).
- `ws` — the active WebSocket (binary `arraybuffer` frames).
- `isDisconnected` — manual-disconnect flag; `reconnectAbandoned` — terminal
  latch set once all hosts exhaust their reconnect budget.
- `iceTimeouts` — per-peer pending ICE candidate timers;
  `webRtcRecoveryTimeouts` — per-peer pending P2P-drop recovery timers.
- `reconnectAttempts` / `reconnectRound` / `isInitialConnection` /
  `inConfiguredHosts` — auto-reconnect retry/backoff/sweep state.
- Callbacks: `onZeroHubError`, `onHubInfo`, `onPeerStatusChange`, `onPeerError`,
  `onOffer`, `onAnswer`.
- `logger` — a `ZeroHubLogger` honoring `logLevel`.

The constructor validates that at least one host is supplied, merges the RTC
config and offer options (over `DEFAULT_RTC_CONFIG` /
`DEFAULT_RTC_OFFER_OPTIONS`), and calls `topology.init(this)`. No network
connection is made until an entrypoint is called.

All connection entrypoints funnel into the private
`openHubConnection(path, hubId?, peerMetadata?, hubMetadata?)` helper, which
stores any supplied metadata on the client, builds a `URL` from
`getWS(host, tls)` (client/src/utils.ts — `wss://` when `tls`, else `ws://`)
with `id`, `hubMetadata`, `peerMetadata` as query params, and calls
`connectToZeroHub(url)`:

| Method | Path | Purpose |
|---|---|---|
| `joinStaticHub(hubId, peerMetadata?)` | `/v1/static-hubs/join` | join a static (never-expires, named) hub |
| `joinOrCreateIPHub(peerMetadata?, hubMetadata?)` | `/v1/ip-hubs/join-or-create` | IP-keyed join-or-create (id derived server-side from the caller's IP) |
| `createRandomHub(peerMetadata?, hubMetadata?)` | `/v1/random-hubs/create` | create a random hub (server picks the id) |
| `joinRandomHub(hubId, peerMetadata?)` | `/v1/random-hubs/join` | join a random hub by id |

All four return a `Promise<void>` that resolves when the signaling
WebSocket opens and rejects when the connection attempt fails.

Static hubs are **created out-of-band by an admin** via the plain-HTTP
`GET /v1/static-hubs/create` endpoint (admin-gated with the
`Authorization` header), not through the SDK — the browser WebSocket API
cannot send custom headers. The former `createHub`/`joinHub`/
`joinOrCreateHub` (the old `/v1/hubs/*` static endpoints) and
`createPermanentHub`/`joinPermanentHub` (the old
`/v1/permanent-hubs/*` endpoints) entry points have been removed. The
former `joinIPHub(hubId)` entry point was also removed: an IP hub's id
is derived from the caller's IP by the server, so a client-supplied hub
id can never resolve to an IP hub (the endpoint always returned 404).
Use `joinOrCreateIPHub` instead.

## WebSocket lifecycle & message dispatch

`connectToZeroHub(url)`:

- **Resets state** for reuse: sets `isDisconnected = false` and clears
  `iceTimeouts`, so a client that previously called `disconnect()` can be
  reconnected cleanly.
- **Tears down a leaked socket**: calls `closeActiveSocket()` to close any
  socket left open by a previous entry-point call that did not go through
  `disconnect()`, nulling all handlers before `close(1000)` so the replaced
  socket does not fire `reconnect()` (which would advance `hostIndex` a second
  time for a single logical failure) or `onZeroHubError`.
- Opens `new WebSocket(url)` with `binaryType = "arraybuffer"`.
- `onmessage` — decodes the frame with `ServerMessage.decode(...)` and routes
  it through `handleZeroHubMessage`.
- `onerror` — logs and fires `onZeroHubError`, but does **not** reconnect:
  per RFC 6455 a network failure fires `error` and then `close` with code
  1006, and reconnecting in both would advance `hostIndex` twice for a single
  failure (skipping two hosts). All reconnection happens in `onclose`.
- `onclose` — interprets the close code: `1000` (normal) does nothing;
  `1001` (going away) hands the close *reason* to `reconnect(url, reason)` as
  the migration redirect — which validates the reason as a well-formed host
  before acting on it (see Reconnection below); `1006`/`1011`/`1012`/`1013`
  (abnormal, internal error, service restart, try-again-later — all
  transient outages) feed the reconnect loop; any other code is a
  protocol-level failure that rejects the still-pending connect `Promise`
  and fires `onZeroHubError`.

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
  `onconnectionstatechange` / `oniceconnectionstatechange` (both schedule a
  delayed P2P-drop recovery via `scheduleWebrtcRecovery` on `disconnected`
  / `failed`), stores it in the map, and marks it `Pending`. Used by both
  the `hubInfoMessage` and `peerJoinedMessage` paths.
- **`removePeer(peerId)`** — clears the peer's pending ICE-candidate
  fallback timer and P2P-drop recovery timer, closes the
  `RTCPeerConnection`, nulls the two state handlers so a stale ICE event
  cannot call back into the client on a closing connection, and deletes
  the peer from the map. No-op if already gone. Used by `disconnect()`,
  the `peerDisconnectedMessage` broadcast, and the `hubInfoMessage`
  roster-prune pass. The caller emits the appropriate status first (it
  differs per path).

`safeParseJson(raw, fallback)` (module-level helper) `JSON.parse`s the raw
metadata string and returns the parsed value on success, or `fallback` when
the input is missing or malformed. The client's private wrapper warns only on
a genuine parse failure — never on a successful parse, since a valid value
can legitimately equal the fallback — so a corrupt hub/peer metadata value
from the server degrades to the fallback instead of crashing the WebSocket
message dispatcher.

## Reconnection: retry, backoff, failover, wraparound

`reconnect(currentURL, newHost?)` is the single entry point for all recovery
paths:

- **Abort** — returns immediately if `isDisconnected` (manual disconnect) or
  if the `reconnectAbandoned` latch is set (the terminal "all hosts
  exhausted" error already fired; only a fresh entry-point call — which
  clears the latch in `connectToZeroHub` — may start a new session).
- **1001 going-away redirect** (when `newHost` is supplied): the close
  reason is first validated as a well-formed host by `isWellFormedHost`
  (client/src/utils.ts — a bare hostname or `host:port`, no scheme, no
  path/query/fragment, no userinfo, port in 0..65535; it mirrors the
  server's `validateBackupHost` for the host emitted in migration closes).
  `1001` is a generic RFC 6455 code, so a proxy or load balancer may close
  with a human-readable reason: a malformed reason logs a warning and falls
  through to the automatic recovery path below **without touching host
  state**. A redirect back to the current host (`newHost === this.host`,
  e.g. an operator pointing `/admin/migrate` at the current host) is
  surfaced through `onZeroHubError` and stopped, since it would cycle
  forever with no backoff and no terminal error. A valid redirect updates
  `this.host` (every entry point builds its URL from it) and `hostIndex`
  (pointing at the redirected host when it is in the configured list),
  resets the retry and sweep budgets, and re-dials immediately.
- **Same-host retry with exponential backoff** — on an abnormal close
  (1006/1011/1012/1013), every host gets a bounded budget of
  `maxReconnectAttempts` (default **10**) same-host re-dials spaced
  `reconnectBaseBackoffMs` (default **250 ms**) × 2^(attempts − 1), with
  ±20% random jitter, capped at 30 seconds — so long-lived sessions survive
  transient blips (Wi-Fi handover, NAT/proxy hiccup, laptop sleep) instead
  of dying permanently. Same-host retries leave `hostIndex` untouched, so
  "a single logical failure advances `hostIndex` exactly once" (pinned by
  `test/tests/multihosts.spec.ts`) still holds. The budget refills only when
  a connection is confirmed (the server's `hubInfoMessage` arrives).
- **Host failover** — when the current host's retry budget is spent and it
  is not the last configured host, `hostIndex` advances to the next host,
  which gets a fresh retry budget.
- **Wraparound** — when the last configured host's budget (with more than
  one configured) or a redirected out-of-list host's budget is spent, the
  sweep wraps back to the FIRST configured host instead of giving up after
  one pass through the list; this is bounded by `maxReconnectRounds`
  (default **2**) full sweeps, so the terminal error stays reachable.
- **Terminal** — when every host's budget is spent on every allowed sweep,
  `reconnectAbandoned` latches and the terminal failure (`all ZeroHub hosts
  are not working, please check the ZeroHub hosts`) is surfaced through
  `onZeroHubError`; any later close on a leftover socket is a no-op.

The initial connection (before any `hubInfoMessage` has ever been
confirmed) skips same-host retry and fails over to the next host
immediately: a first-dial failure is not a transient blip on a confirmed
session. Pending retry timers carry a generation token, so `disconnect()`
and a fresh entry-point dial cancel and invalidate them — a stale timer can
never resurrect a manually disconnected client or dial a stray second
socket.

## Disconnect & reuse

`disconnect()`:

1. Sets `isDisconnected = true`, cancels any queued same-host retry timer,
   and resets `reconnectRound` so a reused client starts with a full sweep budget.
2. Clears all pending `iceTimeouts` and `webRtcRecoveryTimeouts`, so a timer
   can never fire after teardown and resurrect a socket or a peer.
3. Calls the shared `closeActiveSocket()` helper, which detaches all WebSocket
   handlers (`onclose`/`onerror`/`onmessage`/`onopen`) so the close does
   **not** trigger auto-reconnect, then closes the socket with code 1000.
   (The same helper is used by `connectToZeroHub` to replace a socket left
   open by a previous entry-point call.)
4. Transitions every peer to `Disconnected` and closes each
   `RTCPeerConnection` via the shared `removePeer` helper (nulling handlers
   around `close()` so a stale ICE event can't call `restartIce()` on a
   closing connection), then empties the `peers` map.

The client is **reusable** after `disconnect()`: calling any entrypoint again
resets `isDisconnected` (and clears `reconnectAbandoned`) and starts a fresh
connection. `sendZeroHubMessage` throws if called while disconnected, when no
socket exists, or when the socket is not yet `OPEN` (a CONNECTING/CLOSING
socket would otherwise make `ws.send()` throw a raw `InvalidStateError`).

## SDP send/receive

- `sendOffer(peerId, ...)` and `sendAnswer(peerId, offerSdp, ...)` — both
  funnel through the shared private `negotiateWithPeer` helper, which runs
  the op-specific WebRTC steps (`createOffer`/`setLocalDescription`, or
  `setRemoteDescription(offer)`/`createAnswer`/`setLocalDescription`) and
  then delegates the ICE-candidate wait-and-send to the
  `armSendOnIceReady` helper (below). Offer options are **spread into a
  fresh local object** inside `negotiateWithPeer`
  (`{ ...config.rtcOfferOptions, ...rtcOfferOptions }`) rather than
  `Object.assign`-ed onto the shared config, so per-call options can never
  leak into the stored `config.rtcOfferOptions`. A failed exchange is logged,
  surfaced via the `onPeerError` callback, and re-thrown to the caller.
  `sendOffer` transitions the peer to `Offering`; `sendAnswer` to
  `Answering` (the transitions happen in `sendOfferToWebsocket` /
  `sendAnswerToWebsocket`, which wrap the SDP in a `ClientMessage`, send it,
  and advance the peer status).
- `acceptAnswer(peerId, answerSdp)` — sets the remote answer description.

`armSendOnIceReady(peerId, rtcConn, sendOnce)` (private, shared by
`sendOffer` and `sendAnswer` via `negotiateWithPeer`) wires the peer's
`onicecandidate` handler plus a `waitIceCandidatesTimeout` fallback so
`sendOnce` is invoked **exactly once**: `onicecandidate` fires the send on
the first event that carries no candidate (the gathering-complete marker),
skipping events that still carry a candidate; the timer fires the send if no
such event arrives within `waitIceCandidatesTimeout` milliseconds. Every
candidate-bearing event is additionally **trickled** to the remote peer via
`sendIceCandidateToWebsocket` (a `SendIceCandidateMessage` frame) —
including candidates that arrive after the SDP has gone out; if the signaling
socket is not `OPEN` at that moment, the candidate is dropped with a logged
warning rather than throwing. The two paths share a single `isSent` guard,
so re-negotiation (or a late candidate after the timeout) can never send the
SDP a second time. Re-arm clears the prior pending handle for `peerId` so
`disconnect()` cannot miss it and records the timer in
`this.iceTimeouts[peerId]`.

ICE timeout handles are tracked in `iceTimeouts[peerId]`; a prior handle is
cleared before arming a new one, and all handles are cleared on disconnect.

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
  it is the offerer** (`parseInt(peer.id) > parseInt(myPeerId)`).
- **`SFUTopology`** — routes all P2P traffic through a single SFU peer (the
  numerically lowest peer ID by default, or an explicitly set one — peer IDs
  are sequential decimal strings, so election sorts `parseInt(id, 10)` rather
  than lexicographically, or "10" would beat "2"). The SFU offers to every
  client; non-SFU peers only connect to the SFU, so bandwidth scales better
  for larger groups at the cost of a single point of failure.

Both topologies delegate the per-peer WebRTC wiring to the shared helpers in
`client/src/topology/peerSetup.ts` — `setupDataChannel` (offerer creates
`numberOfChannels` channels labeled `"0"`, `"1"`, ...; answerer wires
`ondatachannel`) and `setupMediaChannel` (adds `localStream` tracks, wires
`ontrack`) — with optional log callbacks so each topology keeps its own
logging. The media helper requires call sites to pass the level-gated
`ZeroHubClient.logger`, not the raw user `config.logger`.

Both topologies treat `ZeroHubDisconnected` and `Disconnected` as no-ops. On
`WebRTCDisconnected` (P2P drop while the signaling socket is still alive),
both topologies re-negotiate the existing `RTCPeerConnection` instead of
rebuilding it: the collision-free offer role decides who re-sends the offer
(higher-ID peer in mesh; the SFU in SFU topology, since the SFU is always the
offerer), and the answerer recovers when that offer arrives through the
normal `offerMessage`/`sendAnswer` path. Data channels and media tracks are
**not** re-created — the renegotiation refreshes the ICE/DTLS transport while
the established channels/transceivers persist, so the application is never
handed duplicate channels. The SFU topology additionally **re-elects** a new
SFU when the currently elected one leaves the hub (deduped by
`lastElectingSfuId` against duplicate/delayed departure broadcasts), so the
star does not silently degrade; an explicitly configured `sfuPeerId` is never
overridden by re-election.

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
`maxReconnectAttempts: 10`, `maxReconnectRounds: 2`,
`reconnectBaseBackoffMs: 250`, and `rtcConfig` = Google STUN servers +
`bundlePolicy: "balanced"`. All are overridable via the `Config` interface.
`LogLevel` is `Debug | Warning | Error | None`.

## Peer

`Peer` (client/src/peer.ts) is a thin value: `id`, `status` (`PeerStatus`),
`metadata`, `joinTime`, and the `rtcConn: RTCPeerConnection`. `close()` closes
the WebRTC connection and is safe to call repeatedly.

---
type: subsystem
title: TypeScript Client SDK
description: The @zero-hub/client SDK — ZeroHubClient connection lifecycle, reconnection with host failover, disconnect/reuse semantics, the pluggable topology system, data/media channel configuration, and SDP send/receive.
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
  - id: openwiki-source-718b618612c033c4f36b3a45
    resource: repo://client/src/zeroHub.ts
generated: { by: "hermes", at: "2026-10-13T03:37:16.218Z" }
verified:
  - by: openwiki/0.6.0
    at: 2026-10-13T03:37:16.218Z
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
- `iceTimeouts` — per-peer pending ICE candidate timers.
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
| `createHub(hubId, peerMetadata?, hubMetadata?)` | `/v1/hubs/create` | create a static hub |
| `joinHub(hubId, peerMetadata?)` | `/v1/hubs/join` | join a static hub |
| `joinOrCreateHub(...)` | `/v1/hubs/join-or-create` | join or create |
| `joinOrCreateIPHub(...)` | `/v1/ip-hubs/join-or-create` | IP-keyed join-or-create |
| `joinIPHub(hubId, peerMetadata?)` | `/v1/ip-hubs/join` | join IP hub |
| `createRandomHub(...)` | `/v1/random-hubs/create` | create a random hub |
| `joinRandomHub(hubId, peerMetadata?)` | `/v1/random-hubs/join` | join a random hub |

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
  before acting on it (see Reconnection below); `1006`/`1011`
  (abnormal/internal error) reconnect; anything else fires
  `onZeroHubError`.

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
  `onconnectionstatechange` / `oniceconnectionstatechange` (ICE restart on
  `failed`), stores it in the map, and marks it `Pending`. Used by both the
  `hubInfoMessage` and `peerJoinedMessage` paths.
- **`removePeer(peerId)`** — closes the peer's `RTCPeerConnection`, nulls the
  two state handlers so a stale ICE event cannot call `restartIce()` on a
  closing connection, and deletes the peer from the map. No-op if already
  gone. Used by `disconnect()`, the `peerDisconnectedMessage` broadcast, and
  the `hubInfoMessage` roster-prune pass. The caller emits the appropriate
  status first (it differs per path).

`safeParseJson(raw, fallback)` (module-level helper) `JSON.parse`s the raw
metadata string and returns the parsed value on success, or `fallback` when
the input is missing or malformed. The client's private wrapper warns only on
a genuine parse failure — never on a successful parse, since a valid value
can legitimately equal the fallback — so a corrupt hub/peer metadata value
from the server degrades to the fallback instead of crashing the WebSocket
message dispatcher.

## Reconnection with host failover

`reconnect(currentURL, newHost?)`:

- Returns immediately if `isDisconnected` (manual disconnect).
- If `newHost` is supplied (the 1001 going-away redirect case), the close
  reason is first validated as a well-formed host by `isWellFormedHost`
  (client/src/utils.ts — a bare hostname or `host:port`, no scheme, no
  path/query/fragment, no userinfo, port in 0..65535; it mirrors the
  server's `validateBackupHost` for the host emitted in migration closes).
  `1001` is a generic RFC 6455 code, so a proxy or load balancer may close
  with a human-readable reason: a malformed reason logs a warning and falls
  through to the automatic host-failover path below **without touching host
  state**. A redirect back to the current host (`newHost === this.host`, e.g.
  an operator pointing `/admin/migrate` at the current host) is surfaced
  through `onZeroHubError` and stopped, since it would cycle forever with no
  backoff and no terminal error. A valid redirect updates `this.host` (every
  entry point builds its URL from it) and `hostIndex` (pointing at the
  redirected host when it is in the configured list) before reconnecting.
- Otherwise it calls `getZeroHubBackupHost()`, which advances `hostIndex` to
  the next host in the list and resolves it (rejecting when the last host has
  been exhausted). **Critically, the `isDisconnected` flag is re-checked inside
  the async `.then` callback**, not just at entry — a user calling
  `disconnect()` while the backup-host fetch is in flight must not resurrect
  the connection. It also bails if the backup host equals the current host.
- When every host is exhausted, the rejection reaches the `.catch`, which
  surfaces the terminal failure (`all ZeroHub hosts are not working, please
  check the ZeroHub hosts`) through `onZeroHubError` — there is no further
  automatic retry.

## Disconnect & reuse

`disconnect()`:

1. Sets `isDisconnected = true`.
2. Clears all pending `iceTimeouts`.
3. Calls the shared `closeActiveSocket()` helper, which detaches all WebSocket
   handlers (`onclose`/`onerror`/`onmessage`/`onopen`) so the close does
   **not** trigger auto-reconnect, then closes the socket with code 1000.
   (The same helper is used by `connectToZeroHub` to replace a socket left
   open by a previous entry-point call.)
4. Transitions every peer to `Disconnected` and closes each `RTCPeerConnection`
   (nulling handlers around `close()` so a stale ICE event can't call
   `restartIce()` on a closing connection), then empties the `peers` map.

The client is **reusable** after `disconnect()`: calling any entrypoint again
resets `isDisconnected` and starts a fresh connection. `sendZeroHubMessage`
throws if called while disconnected or when no socket exists.

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

`armSendOnIceReady(peerId, rtcConn, sendOnce)` (private, shared by
`sendOffer` and `sendAnswer`) wires the peer's `onicecandidate` handler plus a
`waitIceCandidatesTimeout` fallback so `sendOnce` is invoked **exactly once**:
`onicecandidate` fires the send on the first event that carries no candidate
(the gathering-complete marker), skipping events that still carry a candidate;
the timer fires the send if no such event arrives within
`waitIceCandidatesTimeout` milliseconds. The two paths share a single `isSent`
guard, so re-negotiation (or a late candidate after the timeout) can never
send the SDP a second time. Re-arm clears the prior pending handle for
`peerId` so `disconnect()` cannot miss it and records the timer in
`this.iceTimeouts[peerId]`.

ICE timeout handles are tracked in `iceTimeouts[peerId]`; a prior handle is
cleared before arming a new one, and all handles are cleared on disconnect.

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
and `rtcConfig` = Google STUN servers + `bundlePolicy: "balanced"`. All are
overridable via the `Config` interface. `LogLevel` is `Debug | Warning | Error
| None`.

## Peer

`Peer` (client/src/peer.ts) is a thin value: `id`, `status` (`PeerStatus`),
`metadata`, `joinTime`, and the `rtcConn: RTCPeerConnection`. `close()` closes
the WebRTC connection and is safe to call repeatedly.

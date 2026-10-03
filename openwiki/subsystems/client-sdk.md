---
type: subsystem
title: TypeScript Client SDK
description: The @zero-hub/client SDK — ZeroHubClient connection lifecycle, reconnection with host failover, disconnect/reuse semantics, the pluggable topology system, data/media channel configuration, and SDP send/receive.
tags: [typescript, client, sdk, webrtc, topology, reconnection, data-channel]
verified:
  - by: openwiki/0.6.0
    at: 2026-10-03T07:04:30.122Z
sources:
  - id: openwiki-source-df0d81c76704b851d02513e1
    resource: repo://client/src/const.ts
  - id: openwiki-source-22df8f9ebcff0eeb4e4ed38f
    resource: repo://client/src/topology/meshTopology.ts
  - id: openwiki-source-bd409d9bd601f67e5d47a03d
    resource: repo://client/src/topology/sfuTopology.ts
  - id: openwiki-source-718b618612c033c4f36b3a45
    resource: repo://client/src/zeroHub.ts
generated: { by: "hermes", at: "2026-10-03T07:04:30.122Z" }
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
- Callbacks: `onZeroHubError`, `onHubInfo`, `onPeerStatusChange`, `onPeerError`.
- `logger` — a `ZeroHubLogger` honoring `logLevel`.

The constructor validates that at least one host is supplied, merges the RTC
config and offer options (over `DEFAULT_RTC_CONFIG` /
`DEFAULT_RTC_OFFER_OPTIONS`), and calls `topology.init(this)`. No network
connection is made until an entrypoint is called.

**Connection entrypoints** each build a `URL` with the appropriate path and
query params, then call `connectToZeroHub(url)`:

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
- Opens `new WebSocket(url)` with `binaryType = "arraybuffer"`.
- `onmessage` — decodes the frame with `ServerMessage.decode(...)` and routes
  it through `handleZeroHubMessage`.
- `onerror` — logs, fires `onZeroHubError`, and calls `reconnect(url)`.
- `onclose` — interprets the close code: `1000` (normal) does nothing;
  `1001` (going away) reconnects to the host named in the close *reason*
  (the migration redirect); `1006`/`1011` (abnormal/internal error) reconnect;
  anything else fires `onZeroHubError`.

`handleZeroHubMessage` branches on the `ServerMessage` oneof:

- `hubInfoMessage` — sets `myPeerId`/`hubInfo`, fires `onHubInfo`, and creates
  `Peer` objects (via `createPeer`) for each roster peer not yet in the map.
- `offerMessage` — moves that peer to `AnswerPending` and, when
  `autoAnswer`, calls `sendAnswer`.
- `answerMessage` — moves the peer to `AcceptPending` and, when
  `autoAcceptAnswer`, calls `acceptAnswer`.
- `peerJoinedMessage` — creates a `Peer` for the joiner (if new).
- `peerDisconnectedMessage` — fires the `ZeroHubDisconnected` status, closes
  the peer's `RTCPeerConnection`, nulls its handlers, and removes it from the
  map.

## Reconnection with host failover

`reconnect(currentURL, newHost?)`:

- Returns immediately if `isDisconnected` (manual disconnect).
- If `newHost` is supplied (the 1001 going-away redirect case), it points the
  URL at `newHost` and reconnects.
- Otherwise it calls `getZeroHubBackupHost()`, which advances `hostIndex` to
  the next host in the list and resolves it (rejecting when the last host has
  been exhausted). **Critically, the `isDisconnected` flag is re-checked inside
  the async `.then` callback**, not just at entry — a user calling
  `disconnect()` while the backup-host fetch is in flight must not resurrect
  the connection. It also bails if the backup host equals the current host.

## Disconnect & reuse

`disconnect()`:

1. Sets `isDisconnected = true`.
2. Clears all pending `iceTimeouts`.
3. Detaches all WebSocket handlers (`onclose`/`onerror`/`onmessage`/`onopen`)
   so the close does **not** trigger auto-reconnect, then closes the socket
   with code 1000.
4. Transitions every peer to `Disconnected` and closes each `RTCPeerConnection`
   (nulling handlers around `close()` so a stale ICE event can't call
   `restartIce()` on a closing connection), then empties the `peers` map.

The client is **reusable** after `disconnect()`: calling any entrypoint again
resets `isDisconnected` and starts a fresh connection. `sendZeroHubMessage`
throws if called while disconnected or when no socket exists.

## SDP send/receive

- `sendOffer(peerId, ...)` — runs `createOffer`/`setLocalDescription`, wires
  `onicecandidate`, and flushes the SDP to the server either on candidate
  completion or after `waitIceCandidatesTimeout`. Transitions the peer to
  `Offering`.
- `sendAnswer(peerId, offerSdp, ...)` — sets the remote offer description,
  creates the answer, and flushes it back. Transitions to `Answering`.
- `acceptAnswer(peerId, answerSdp)` — sets the remote answer description.
- `sendOfferToWebsocket` / `sendAnswerToWebsocket` — wrap the SDP in a
  `ClientMessage` and send it; they also advance the peer status.

ICE timeout handles are tracked in `iceTimeouts[peerId]`; a prior handle is
cleared before arming a new one, and all handles are cleared on disconnect.

## Topology system

The `Topology` interface (client/src/topology/topology.ts) has `init(zeroHub)`
and `onPeerStatusChange(peer)`. The `ZeroHubClient` calls
`topology.onPeerStatusChange` on every status update (before user callbacks).
Two built-ins:

- **`MeshTopology`** (default) — full mesh. On `Pending`, it creates
  `numberOfChannels` data channels (labeled `"0"`, `"1"`, ...) if a
  `dataChannelConfig` is set (the offerer creates them; the answerer wires
  `ondatachannel`), adds media tracks if a `localStream` is configured, and
  sends the offer **only if it is the offerer** (`parseInt(peer.id) >
  parseInt(myPeerId)`).
- **`SFUTopology`** — routes all P2P traffic through a single SFU peer (lowest
  ID by default, or an explicitly set one). The SFU offers to every client;
  non-SFU peers only connect to the SFU, so bandwidth scales better for
  larger groups at the cost of a single point of failure.

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

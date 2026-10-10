---
type: architecture
title: Architecture Overview
description: End-to-end explanation of how ZeroHub's Go signaling server, TypeScript client SDK, protobuf wire protocol, and pluggable storage cooperate to turn a hub join into a direct peer-to-peer WebRTC connection.
tags: [architecture, webrtc, signaling, server, client, protobuf]
verified:
  - by: openwiki/0.6.0
    at: 2026-10-10T01:28:37.861Z
sources:
  - id: openwiki-source-22df8f9ebcff0eeb4e4ed38f
    resource: repo://client/src/topology/meshTopology.ts
  - id: openwiki-source-3fc48cf443ddea6d020b0fe8
    resource: repo://client/src/topology/topology.ts
  - id: openwiki-source-718b618612c033c4f36b3a45
    resource: repo://client/src/zeroHub.ts
  - id: openwiki-source-926f5bdf2e4b77b0b06cf4e8
    resource: repo://server/cmd/server.go
  - id: openwiki-source-da50555ad2e1dffee0054a4e
    resource: repo://server/pkg/hub/hub.go
  - id: openwiki-source-c8f6dfeddac50cd2f28ba214
    resource: repo://server/pkg/storage/storage.go
generated: { by: "hermes", at: "2026-10-03T07:04:30.122Z" }
---

# Architecture Overview

ZeroHub is a WebRTC signaling system. It is a **monorepo** with two deployable
components plus shared wire-format definitions:

- **`server/`** — a Go signaling server (the only server-side artifact). It
  runs on `fasthttp`, manages hubs and the peers inside them, and relays
  signaling messages between peers over WebSocket. It is **not** in the data
  path: once WebRTC is established, media and data flow directly between peers.
- **`client/`** — the TypeScript/JavaScript SDK (`@zero-hub/client`). It opens
  the WebSocket to the server, drives SDP offer/answer negotiation, and hands
  the resulting `RTCPeerConnection`s to a pluggable topology.
- **`proto/`** — Protobuf definitions for the client↔server wire format
  (`client_message.proto`, `server_message.proto`). These are the single source
  of truth, compiled into TypeScript for the client and Go for the server.
- **`test/`** — E2E tests (Playwright + Svelte) that drive the real client SDK
  against two live server instances.
- **`docs/`** — an Astro-based documentation site.

## The three layers

```
Browser / Node client                    Go signaling server                Wire
──────────────────────────────────────   ────────────────────────────      ────
ZeroHubClient ──createHub/joinHub──▶    fasthttp handler ──upgrade──▶  WebSocket
   │  (HTTP GET, query params)              (hub routing)                 (protobuf)
   │                                           │
   └── ServerMessage ◀──── hub/peer broadcast ◀┘
   │
   ▼
RTCPeerConnection  ◀──── direct P2P (SDP carried only via signaling) ────▶
   other peers' RTCPeerConnection
```

## End-to-end flow

### 1. Entry: server bootstrap

`server/cmd/server.go` is the entrypoint. It loads configuration
(`config.LoadConfig`), initializes the zerolog logger, then constructs **four
independent `ZeroHub` instances** — one per hub type (static, random, IP,
permanent) — and hands them to `handler.NewHandler`, which `Serve()`s the
fasthttp server on `APP_HOST:APP_PORT` (default `0.0.0.0:8080`).

The four instances matter because each hub "type" has different ID semantics
and expiry; see the Go Signaling Server page for the routing table.

### 2. Hub join / create over HTTP→WebSocket

A client calls one of the connection entrypoints
(`createHub`, `joinHub`, `joinOrCreateHub`, IP/random variants). Each opens a
WebSocket to a typed path (e.g. `/v1/hubs/create`, `/v1/hubs/join`) with `id`,
`peerMetadata`, `hubMetadata` as query parameters. The handler authenticates
where needed, resolves or creates the hub on the right `ZeroHub` instance, and
upgrades the HTTP connection to a WebSocket.

On upgrade (`handler.Upgrade`), the server wraps the socket in a
`peer.Peer`, calls `hub.AddPeer`, and starts `hub.HandleMessage` — a read loop
that decodes `ClientMessage` protobuf frames.

### 3. Signaling via protobuf

All frames on the WebSocket are protobuf. The server sends `ServerMessage`
(oneof: `hub_info_message`, `peer_joined_message`, `peer_disconnected_message`,
`offer_message`, `answer_message`, `ice_candidate_message`); the client sends
`ClientMessage` (oneof: `send_offer_message`, `send_answer_message`,
`send_ice_candidate_message`, `update_peer_metadata_message`).

When a peer joins, the hub assigns it a monotonically increasing numeric ID,
broadcasts a `PeerJoinedMessage` to existing peers, and sends the newcomer a
`HubInfoMessage` carrying its own ID, the hub's metadata, and the roster of
existing peers. The client materializes `Peer` objects for the roster, each
starting at `PeerStatus.Pending`.

### 4. SDP offer/answer over the socket

For each pending peer, the client performs the WebRTC negotiation. The
**offer-collision rule** (in the default `MeshTopology`) decides who offers:
the peer with the **higher numeric ID creates the offer** to the lower ID.
The offerer creates any configured data channels and media tracks, generates
the SDP offer, and ships it to the server via `ClientMessage.send_offer_message`;
the server's hub forwards it to the target peer as `ServerMessage.offer_message`.
The answerer auto-answers (`autoAnswer` defaults true) and returns the SDP via
`send_answer_message`. ICE candidates are flushed after a short
`waitIceCandidatesTimeout` (default 2000 ms) rather than waiting indefinitely.

Once both ends have set remote descriptions, the `RTCPeerConnection` reaches
`connected` and the peer transitions to `PeerStatus.Connected`.

### 5. Direct P2P — server exits the path

From here on, data channels (SCTP/DTLS) and media streams (RTP/SRTP) travel
directly between peers, bypassing the server. The server remains only as the
signaling authority: it relays join/leave events and SDP, and tears down
peers/hubs on socket close.

## Peer lifecycle (client-side)

`PeerStatus` (in `client/src/types.ts`) captures the negotiation state machine:

`Pending → Offering / AnswerPending → Answering / AcceptPending → Connected`,
with terminal/failure states `WebRTCDisconnected` (P2P dropped, signaling
alive — recoverable via ICE restart), `ZeroHubDisconnected` (server broadcast
the peer left; the local peer is torn down), and `Disconnected` (local
`disconnect()` tore everything down).

## Ownership & extension seams

- **Server**: `zerohub.ZeroHub` (hub registry), `hub.Hub` (peer set + SDP
  relay), `peer.Peer` (socket + metadata), `storage.Storage[T]` (pluggable
  in-memory or Gache backends for hubs *and* peers).
- **Client**: `ZeroHubClient` (connection + SDP), `Topology` interface (how
  peers wire together) with `MeshTopology` (default) and `SFUTopology`.

The `Topology` interface is the primary extension point: it observes
`onPeerStatusChange` and decides, per peer, whether to create data channels,
add media tracks, and who sends the offer. `MeshTopology` connects every peer
to every peer; `SFUTopology` routes all traffic through a single designated
peer (lowest ID by default) for larger-group scalability.

The protobuf definitions are the contract between the two components: any wire
change must be made in `proto/`, then regenerated (`make proto-gen`) for both
languages. See the Signaling Protocol page for the full message inventory.

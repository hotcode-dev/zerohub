---
type: protocol
title: Signaling Protocol & Peer Lifecycle
description: The ZeroHub client/server protobuf wire format, the SDP offer/answer exchange and offer-collision rule, ICE candidate flushing, and the full PeerStatus lifecycle that drives peer negotiation.
tags: [protobuf, signaling, webrtc, sdp, peer-lifecycle, protocol]
verified:
  - by: openwiki/0.6.0
    at: 2026-10-03T07:04:30.122Z
sources:
  - id: openwiki-source-718b618612c033c4f36b3a45
    resource: repo://client/src/zeroHub.ts
  - id: openwiki-source-f883369ffaf926acfc02d144
    resource: repo://proto/zerohub/v1/client_message.proto
  - id: openwiki-source-62e06788e589f96b4e0f6c7b
    resource: repo://proto/zerohub/v1/server_message.proto
  - id: openwiki-source-da50555ad2e1dffee0054a4e
    resource: repo://server/pkg/hub/hub.go
generated: { by: "hermes", at: "2026-10-03T07:04:30.122Z" }
---

# Signaling Protocol & Peer Lifecycle

The client and server communicate exclusively with **protobuf-encoded binary
WebSocket frames**. The two schemas are the wire contract and live in
`proto/zerohub/v1/`: `client_message.proto` (client → server) and
`server_message.proto` (server → client). Both are compiled into the
TypeScript client (`client/src/proto/...`) and the Go server
(`server/pkg/proto/...`) via `make proto-gen`.

## Message envelopes

Both sides use a `oneof` envelope so each frame is exactly one logical
message:

**ClientMessage (client → server)**

| oneof variant | Payload fields |
|---|---|
| `send_offer_message` | `answer_peer_id`, `offer_sdp` |
| `send_answer_message` | `offer_peer_id`, `answer_sdp` |
| `send_ice_candidate_message` | `peer_id`, `candidate` (unused) |
| `update_peer_metadata_message` | `peer_id`, `metadata` (unused in server handler) |

**ServerMessage (server → client)**

| oneof variant | Payload fields |
|---|---|
| `hub_info_message` | `id`, `create_time`, `my_peer_id`, `hub_metadata`, `repeated Peer peers` |
| `peer_joined_message` | `peer` |
| `peer_disconnected_message` | `peer_id` |
| `offer_message` | `offer_peer_id`, `offer_sdp` |
| `answer_message` | `answer_peer_id`, `answer_sdp` |
| `ice_candidate_message` | `peer_id`, `candidate` (not used yet) |

`Peer` is `{ id, metadata, join_time }` — a string ID plus a JSON-serialized
metadata string (the client parses `metadata` with `JSON.parse`).

Note the ID-direction asymmetry: a `SendOfferMessage` is keyed by the
*answer* peer (who should answer), while a `SendAnswerMessage` is keyed by the
*offer* peer (who should accept the answer). The server's
`hub.HandleMessage` uses this to route the frame to the correct peer.

## The SDP offer/answer exchange

The server never inspects SDP content — it only relays it. The exchange:

1. The hub learns of new/existing peers and the client creates `Peer` objects
   (one per peer) at `PeerStatus.Pending`.
2. **Offer-collision rule**: in `MeshTopology`, the peer whose numeric ID is
   *higher* than the peer it is negotiating with is the **offerer**. The
   topology computes `isOfferer = parseInt(peer.id) > parseInt(myPeerId)` and
   only the offerer calls `sendOffer`. This guarantees exactly one offer per
   pair, preventing the double-offer race.
3. The offerer (in `MeshTopology.onPeerStatusChange`) first creates any
   configured data channels and adds media tracks, **then** calls
   `sendOffer`. `sendOffer` runs `createOffer`/`setLocalDescription` and wires
   `onicecandidate`.
4. The SDP is shipped to the server via `ClientMessage.send_offer_message`
   (`sendOfferToWebsocket`), and the peer transitions to `PeerStatus.Offering`.
   The server's hub forwards it as `ServerMessage.offer_message` to the target.
5. The target decodes the `offer_message`, moves to `PeerStatus.AnswerPending`,
   and (when `autoAnswer`, default true) calls `sendAnswer`, which sets the
   remote offer description, creates the answer, and ships it back via
   `send_answer_message`. It transitions to `PeerStatus.Answering`.
6. The offerer decodes the `answer_message`, moves to
   `PeerStatus.AcceptPending`, and (when `autoAcceptAnswer`, default true)
   calls `acceptAnswer` to set the remote answer description.
7. Once the `RTCPeerConnection` reaches `connectionState === "connected"`, the
   client marks the peer `PeerStatus.Connected`.

## ICE candidate handling

Rather than signaling individual ICE candidates (the
`ice_candidate_message` / `send_ice_candidate_message` frames exist but are
marked unused), ZeroHub relies on **trickle-avoidance via a timeout**:

- In `sendOffer`/`sendAnswer`, `onicecandidate` sends the SDP to the server the
  moment `event.candidate` is null (gathering finished) and no prior send
  happened.
- A `setTimeout` of `waitIceCandidatesTimeout` (default **2000 ms**, from
  `DEFAULT_CONFIG`) fires as a fallback: if candidates are still pending, it
  flushes the current SDP anyway so negotiation is not blocked forever.
- Pending ICE timeout handles are tracked per peer in `iceTimeouts` and cleared
  on `disconnect()`, so a timer can never write to a closed socket. The prior
  handle for a peer is always cleared before arming a new one.

## Peer status lifecycle

`PeerStatus` (in `client/src/types.ts`) is the client-side state machine:

```
Pending
 ├─ (local is offerer)  → Offering        (offer sent)
 │                         → AcceptPending (answer received) → Connected
 └─ (local is answerer) → AnswerPending   (offer received)
                           → Answering     (answer sent)     → Connected
```

Beyond the happy path there are three terminal/abnormal states:

- **`WebRTCDisconnected`** — the P2P connection dropped
  (`connectionState === "disconnected"`) while the peer is still in the hub
  and the client is still connected to ZeroHub. Recoverable; the client also
  calls `restartIce()` on `iceConnectionState === "failed"`.
- **`ZeroHubDisconnected`** — the server broadcast a
  `PeerDisconnectedMessage` (the peer left the hub). The local client fires
  the status change, closes the peer's `RTCPeerConnection`, nulls its ICE/
  connection handlers, and removes the peer from the `peers` map.
- **`Disconnected`** — the local client called `disconnect()`, closing the
  ZeroHub WebSocket and tearing down every peer. No peer can be restored until
  the client reconnects via `createHub()`/`joinHub()`.

The topology observes every transition through `onPeerStatusChange`, which is
where `MeshTopology` triggers the offer (on `Pending`, if it is the offerer)
and where `SFUTopology` decides which peers wire directly to the SFU.

## Invariants & failure behavior

- **One offer per pair** — enforced by the higher-ID-offers rule; both peers
  observe the same roster, so both independently compute the same offerer.
- **Server is stateless w.r.t. SDP** — it relays frames verbatim between the
  named peers; a mis-addressed or missing target peer just logs an error and
  drops the frame.
- **Non-binary or unparseable frames end the read loop** — `hub.HandleMessage`
  breaks on read errors, non-`BinaryMessage` frames, or protobuf unmarshal
  failures.
- The `autoAnswer` / `autoAcceptAnswer` config flags default to `true`; setting
  either to `false` shifts the corresponding step to a manual client call.

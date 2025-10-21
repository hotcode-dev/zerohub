---
title: SDK Reference
description: Reference for the ZeroHub JavaScript/TypeScript client SDK.
---

This page documents the public surface of the ZeroHub Client SDK:

- initialization and configuration
- topologies (Mesh)
- hub lifecycle (create/join/join-or-create)
- peer lifecycle (offer/answer/accept)

## Installation

```bash
npm install @zero-hub/client
```

## Initialization

Import and construct a client instance:

```ts
import { MeshTopology, ZeroHubClient, LogLevel } from "@zero-hub/client";

const client = new ZeroHubClient(
  ["sg1.zerohub.dev"],
  {
    tls: true,
    logLevel: LogLevel.Warning,
  },
  new MeshTopology()
);
```

## Config reference

- `tls` (boolean) - Use wss (TLS) for the server connection. Default: `true`.
- `logLevel` (enum) - Logging level. Default: `LogLevel.Warning`.
- `logger` (Logger) - Custom logger implementing the minimal logging functions.
- `waitIceCandidatesTimeout` (number) - Milliseconds to wait for ICE candidates before sending offer/answer. Default: `2000`.
- `autoAnswer` / `autoAcceptAnswer` (boolean) - Automatic handling for incoming offers/answers. Default: `true`.
- `rtcConfig` (RTCConfiguration) - RTCPeerConnection configuration (STUN/TURN servers, etc).
- `rtcOfferOptions` (RTCOfferOptions) - Default offer options used when creating offers/answers. Example default: `{ offerToReceiveAudio: false, offerToReceiveVideo: false }`.
- `dataChannelConfig` (optional) - Configure data channel creation and handler.
- `mediaChannelConfig` (optional) - Configure local media stream and track handling.

## Topology: Mesh

The library ships with a `MeshTopology` implementation that connects every peer to every other peer.
It handles:

- creating data channels (if configured)
- creating offers/answers using a deterministic "higher-id creates offer" rule to avoid collisions
- wiring media tracks from a local stream to remote peers

## Hub lifecycle

- `createHub(hubId, peerMetadata?, hubMetadata?)` - create and join a hub
- `joinHub(hubId, peerMetadata?)` - join an existing hub
- `joinOrCreateHub(hubId, peerMetadata?, hubMetadata?)` - join or create a fixed hub
- `createRandomHub(peerMetadata?, hubMetadata?)` / `joinRandomHub(hubId, peerMetadata?)` - random hub APIs
- `joinOrCreateIPHub(peerMetadata?, hubMetadata?)` / `joinIPHub(hubId, peerMetadata?)` - IP hub APIs

## Peer lifecycle and signaling

The SDK exposes high-level methods for WebRTC signaling:

- `sendOffer(peerId, rtcOfferOptions?, rtcConfig?)` - create and send an offer to a peer
- `sendAnswer(peerId, offerSdp, rtcOfferOptions?, rtcConfig?)` - generate and send an answer
- `acceptAnswer(peerId, answerSdp)` - set remote answer SDP

The SDK will by default wait for ICE candidates for `waitIceCandidatesTimeout` ms before forcing the offer/answer to be sent.

## Events

- `onHubInfo(hubInfo)` - fired when hub metadata or peer list updates
- `onPeerStatusChange(peer)` - fired when a peer status changes (Pending, Connected, etc.)
- `onZeroHubError(error)` - when websocket or server errors occur

## Example: data channel chat

```ts
const topology = new MeshTopology();
const client = new ZeroHubClient(["sg1.zerohub.dev"], { logLevel: LogLevel.Debug }, topology);

client.config.dataChannelConfig = {
  rtcDataChannelInit: { ordered: true },
  onDataChannel: (peer, dc, isOwner) => {
    dc.onmessage = (ev) => console.log(`from ${peer.id}:`, ev.data);
  },
};

await client.joinRandomHub({ displayName: "alice" }, { topic: "chat" });
```

## Further reading

- See the guide: [TypeScript SDK](/docs/guides/typescript-sdk)
- Protocol messages are defined in the `proto/` folder of the repository

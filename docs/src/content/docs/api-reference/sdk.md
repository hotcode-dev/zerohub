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
- `maxReconnectAttempts` (number) - Same-host retries after an abnormal close (1006/1011) on the last configured host before the terminal `onZeroHubError`. Default: `10`. The counter resets to zero when a connection is confirmed (the server's hub info arrives).
- `reconnectBaseBackoffMs` (number) - Base delay (ms) for the exponential backoff between same-host reconnect retries; each retry doubles the previous delay with ±20% jitter, capped at 30 s. Default: `250`.

### Automatic reconnection

When a signaling WebSocket closes abnormally (code `1006` abnormal close or
`1011` internal error), the client reconnects automatically: it fails over to
the next configured host immediately when one is available (a single failure
advances the host index exactly once), and retries the **same** last host with
exponential backoff when it is already on the final host — including the
common single-host deployment. The terminal `onZeroHubError` fires only after
the retry budget is exhausted, or when a manual `disconnect()` leaves no
recovery path.

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
- `joinOrCreateIPHub(peerMetadata?, hubMetadata?)` - IP hub API (hub id is derived from the caller's IP)
- `joinPermanentHub(hubId, peerMetadata?)` - join an existing permanent (never-expires) hub

These entry points all return `void` — they open the WebSocket connection
asynchronously. Hub join completion is delivered via the `onHubInfo` callback
(and subsequent peer activity via `onPeerStatusChange`), never via a Promise,
so do not `await` them or read `myPeerId`/`peers` immediately after the call.

Permanent hubs are created out-of-band via the admin HTTP endpoint
`GET /v1/permanent-hubs/create` (requires the `Authorization` header), since
the browser WebSocket API cannot send custom headers. Use an HTTP client
(curl, `fetch` from a Node.js process) to create a permanent hub, then connect
to it with `joinPermanentHub`.

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

// Fire-and-forget: `joinRandomHub` returns `void` and the connection is
// established asynchronously. The join completes when the `onHubInfo`
// callback fires — do not read `myPeerId` or `peers` immediately after.
client.joinRandomHub({ displayName: "alice" }, { topic: "chat" });
```

## Further reading

- See the guide: [TypeScript SDK](/guides/typescript-sdk)
- Protocol messages are defined in the `proto/` folder of the repository

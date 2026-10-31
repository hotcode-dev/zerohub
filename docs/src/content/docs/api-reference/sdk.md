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
- `maxReconnectRounds` (number) - Number of additional full sweeps through the configured host list (wrapping back to the first host after the last host's retry budget is exhausted) before the terminal `onZeroHubError`. Default: `2`. The round counter resets when a connection is confirmed (the server's hub info arrives), when a migration redirect lands, or on `disconnect()`.

### Automatic reconnection

When a signaling WebSocket closes abnormally (code `1006` abnormal close or
`1011` internal error), the client reconnects automatically:

- An established session (the server's hub info has confirmed the connection
  at least once) first retries the **same** host with exponential backoff
  (base `reconnectBaseBackoffMs`, doubling each retry with ±20% jitter,
  capped at 30 s), up to `maxReconnectAttempts` attempts. A transient blip
  (NAT rebind, WiFi reassociation, laptop suspend/resume) is recovered this
  way without the application intervening.
- The first connection (before any host has confirmed a session) fails over
  to the next configured host immediately instead — a single failure advances
  the host index exactly once, and each host gets a fresh retry budget.
- When a host's retry budget is exhausted the client moves on: to the next
  configured host, or — on the last host — wraps back to the first host for
  another full sweep, bounded by `maxReconnectRounds` sweeps (default `2`).
- Only when every host's retry budget is spent on every allowed sweep does
  the terminal `onZeroHubError` fire; a manual `disconnect()` also leaves no
  recovery path, since the client never re-dials after an intentional
  teardown.

The retry budget and the sweep round reset to zero whenever a connection is
confirmed (the server's hub info arrives) or a migration redirect (close code
`1001` with a well-formed backup host) lands, so a long-lived healthy session
never accumulates backoff.

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

These entry points all return `Promise<void>`: the Promise resolves when the
signaling WebSocket **opens** and rejects when the connection attempt fails
(a failed dial — DNS failure / connection refused — or an abnormal close with
a code other than `1000`/`1001`/`1006`/`1011`). Note that "socket open" is
not "hub joined": the server's hub info arrives after the socket opens, so
hub join completion is still delivered via the `onHubInfo` callback (and
subsequent peer activity via `onPeerStatusChange`). `await` the call to know
the socket is open, but do not read `myPeerId`/`peers` immediately after the
`await` — they are populated when `onHubInfo` fires. Since the Promise
rejects on connection failure, handle the rejection (try/catch or `.catch`)
instead of dropping the returned Promise.

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
- `onPeerError(peer, error)` - fired when a per-peer WebRTC signaling exchange fails (creating/applying SDP or a media-track error); transient signaling-socket delivery failures are retried automatically and are not reported here
- `onOffer(peer, offerSdp)` - fired when `autoAnswer` is `false`; complete the exchange by calling `sendAnswer(peer.id, offerSdp)`
- `onAnswer(peer, answerSdp)` - fired when `autoAcceptAnswer` is `false`; complete the exchange by calling `acceptAnswer(peer.id, answerSdp)`
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

// `joinRandomHub` returns a Promise that resolves when the signaling socket
// opens and rejects on connection failure, so `await` it (or `.catch`) —
// never drop the returned Promise. The join itself completes later, when the
// `onHubInfo` callback fires, so don't read `myPeerId` or `peers` right
// after the `await`.
await client.joinRandomHub(
  "my-random-hub-id", // random hub id returned to the creator via onHubInfo
  { displayName: "alice" } // peer metadata shared with other peers
);
```

## Further reading

- See the guide: [TypeScript SDK](/guides/typescript-sdk)
- Protocol messages are defined in the `proto/` folder of the repository

# ZeroHub SDK

The official TypeScript/JavaScript client for the ZeroHub WebRTC signaling server. ZeroHub SDK manages hub negotiation, SDP exchange, and peer lifecycle events so you can focus on building real-time P2P features.

## Highlights

- Mesh topology out of the box with a pluggable `Topology` interface.
- Type-safe peer and hub metadata via generics (`ZeroHubClient<PeerMetadata, HubMetadata>`).
- Auto-offer collision avoidance by comparing numeric peer IDs.
- Data channel + media channel helpers with configurable ICE wait window.
- Multi-host fallback: automatically reconnects to the next host when the current one fails.

## Quickstart

1. Install the package:

```bash
npm install @zero-hub/client
```

2. Instantiate the client with your ZeroHub hosts:

```ts
import { ZeroHubClient, LogLevel } from "@zero-hub/client";

type PeerMetadata = { name: string };
type HubMetadata = { roomName: string };

const client = new ZeroHubClient<PeerMetadata, HubMetadata>(
  ["sg1.zerohub.dev"],
  {
    tls: false,
    logLevel: LogLevel.Debug,
    waitIceCandidatesTimeout: 2000,
  }
);
```

3. Create or join a hub and respond to lifecycle events:

```ts
client.onHubInfo = (hub) => console.log("Joined hub", hub.id);
client.onPeerStatusChange = (peer) => console.log(peer.id, peer.status);

client.createHub("demo-room", { name: "Alice" }, { roomName: "Demo" });
// Alternatives:
// client.joinHub('demo-room', { name: 'Bob' });
// client.joinRandomHub('lobby', { name: 'Carol' });
```

## Client configuration

| Option                            | Default                                                      | Description                                                                   |
| --------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `tls`                             | `true`                                                       | Switches between `wss://` and `ws://` when connecting. Disable for local dev. |
| `logLevel`                        | `LogLevel.Warning`                                           | Controls `ZeroHubLogger` verbosity. Set to `LogLevel.Debug` while debugging.  |
| `waitIceCandidatesTimeout`        | `2000`                                                       | Milliseconds to gather ICE candidates before sending offers/answers.          |
| `autoAnswer` / `autoAcceptAnswer` | `true`                                                       | Turn off `autoAnswer` to surface offers via the `onOffer` callback + `sendAnswer(peer.id, offerSdp)`. Turn off `autoAcceptAnswer` to surface answers via the `onAnswer` callback + `acceptAnswer(peer.id, answerSdp)`. |
| `rtcConfig`                       | Google STUN servers                                          | Merge with your own TURN/STUN list per peer connection.                       |
| `rtcOfferOptions`                 | `{ offerToReceiveAudio: false, offerToReceiveVideo: false }` | Provide custom `RTCOfferOptions` when creating offers.                        |
| `dataChannelConfig`               | `undefined`                                                  | Configure data channel count, init options, and callback.                     |
| `mediaChannelConfig`              | `undefined`                                                  | Attach local media streams and handle remote tracks.                          |
| `maxReconnectAttempts`            | `10`                                                         | Same-host retries after an abnormal close (1006/1011) on the last host before the terminal `onZeroHubError`. Resets when a connection is confirmed. |
| `reconnectBaseBackoffMs`          | `250`                                                        | Base delay for the exponential backoff between same-host reconnect retries (doubles each attempt, ±20% jitter, capped at 30 s). |

Partial configs are merged with `DEFAULT_CONFIG`, so you only set what you need.

## Manual offer handling

By default the client answers every incoming offer automatically. To take control, set `autoAnswer: false` and complete the exchange yourself from the `onOffer` callback:

```ts
const client = new ZeroHubClient<PeerMetadata, HubMetadata>(hosts, {
  autoAnswer: false,
});

client.onOffer = (peer, offerSdp) => {
  // `peer.status` is `PeerStatus.AnswerPending` here.
  client.sendAnswer(peer.id, offerSdp);
};
```

## Manual answer handling

By default the client accepts every incoming answer automatically. To take control, set `autoAcceptAnswer: false` and complete the exchange yourself from the `onAnswer` callback:

```ts
const client = new ZeroHubClient<PeerMetadata, HubMetadata>(hosts, {
  autoAcceptAnswer: false,
});

client.onAnswer = (peer, answerSdp) => {
  // `peer.status` is `PeerStatus.AcceptPending` here.
  client.acceptAnswer(peer.id, answerSdp);
};
```

## Peer lifecycle events

`PeerStatus` values indicate the mesh negotiation state:

| Status                | When it fires                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------- |
| `Pending`             | Discovered a new peer; waiting for offer/answer decision. Higher peer ID becomes the offerer. |
| `Offering`            | Local peer is generating an offer.                                                            |
| `AnswerPending`       | Received remote offer; waiting for local answer.                                              |
| `Answering`           | Local peer is sending an answer to the offerer.                                               |
| `AcceptPending`       | Waiting for remote acceptance after sending an answer.                                        |
| `Connected`           | WebRTC connection established; channels/tracks ready.                                         |
| `WebRTCDisconnected`  | ICE connection lost. SDK will try fallbacks if available.                                     |
| `ZeroHubDisconnected` | Peer disconnected from the signaling server.                                                  |

Subscribe via `client.onPeerStatusChange` to drive UI state or retries.

## Working with data channels

ZeroHub creates channels on the offerer side and mirrors them for the answerer. Configure staggered channels to separate traffic types:

```ts
const dataClient = new ZeroHubClient<PeerMetadata, HubMetadata>(hosts, {
  dataChannelConfig: {
    numberOfChannels: 3,
    rtcDataChannelInit: { ordered: true },
    onDataChannel: (peer, channel, isOwner) => {
      if (channel.label === "0") channel.onmessage = handleControl;
      if (channel.label === "1") channel.onmessage = handleRealtime;
      if (channel.label === "2") channel.onmessage = handleFileChunk;
      if (isOwner) console.info("Created channel", channel.label);
    },
  },
});
```

For media streams, supply `mediaChannelConfig` with a `localStream` and `onTrack` callback before joining a hub.

## Hub workflows

- `createHub(id, peerMetadata?, hubMetadata?)`
- `joinHub(id, peerMetadata?)`
- `joinOrCreateHub(id, peerMetadata?, hubMetadata?)`
- `joinOrCreateIPHub(peerMetadata?, hubMetadata?)`
- `createRandomHub(peerMetadata?, hubMetadata?)`
- `joinRandomHub(id, peerMetadata?)`
- `joinPermanentHub(id, peerMetadata?)` - join an existing permanent (never-expires) hub

Permanent hubs are created out-of-band via the admin HTTP endpoint
`GET /v1/permanent-hubs/create` (requires the `Authorization` header), since
the browser WebSocket API cannot send custom headers. Use an HTTP client
(curl, `fetch` from a Node.js process) to create a permanent hub, then connect
to it with `joinPermanentHub`.

Each call issues a WebSocket handshake to `/v1/...` endpoints on the ZeroHub server. Metadata objects are serialized and shared with other peers upon connection.

## Topology customization

The SDK ships with `MeshTopology`, which compares numeric peer IDs to avoid offer glare. To implement a different strategy (e.g., SFU coordination), implement the `Topology` interface in `client/src/topology` and pass an instance as the third argument of `ZeroHubClient`.

```ts
import { MeshTopology } from "@zero-hub/client";

const client = new ZeroHubClient(hosts, config, new MeshTopology());
```

## Reconnection & host failover

- Provide multiple hosts: `['sg1.zerohub.dev', 'sg2.zerohub.dev']`.
- When a WebSocket closes abnormally (code `1006` abnormal close or `1011`
  internal error), the client reconnects automatically:
  - An ESTABLISHED session (the server's hub info has confirmed the
    connection at least once) first retries the **same host** with
    exponential backoff and jitter (250 ms, 500 ms, 1 s, 2 s, ... capped
    at 30 s), up to `maxReconnectAttempts` attempts (default 10, base delay
    `reconnectBaseBackoffMs`). A transient blip (NAT rebind, WiFi
    reassociation, mobile-sleep wake, laptop suspend/resume) is recovered
    this way without the application intervening.
  - The FIRST connection (before any host has confirmed a session) fails
    over to the next host in the list immediately instead — a single
    failure advances the host index exactly once.
  - When a host's retry budget is genuinely exhausted the client moves on:
    to the next configured host, or — on the last host — wraps back to the
    first host for an additional full sweep, bounded by
    `maxReconnectRounds` sweeps (default 2).
  - A migration redirect (close code `1001` with a well-formed backup host)
    moves the client to the redirected host and gives it its own retry
    budget; if that host later drops abnormally the client retries it the
    same way instead of giving up. A redirect back to the host we are
    already on (an operator misconfiguration) is surfaced via
    `onZeroHubError` and not retried.
  - Only when every host's retry budget is spent on every allowed sweep does
    the terminal failure surface via `onZeroHubError` — exactly once; after
    that the client is latched and further closes are no-ops until the
    application calls an entry point (`createHub()`, `joinHub()`, ...) again.
- The retry budget and the sweep round reset to zero whenever a connection
  is confirmed (the server's hub info arrives) or a migration redirect
  (code `1001`) lands, so a long-lived healthy session never accumulates
  backoff.
- A manual `disconnect()` cancels any queued retry and resets the sweep
  round: the client never re-dials on its own after an intentional
  teardown.
- Listen to `onZeroHubError` to surface unrecoverable errors to the user
  interface.

## Developing locally

1. Install dependencies once:

```bash
npm install
```

2. Run checks during development:

```bash
npm run lint
npm run format:check
npm run tsc
```

3. Produce build artifacts (ESM, CJS, types):

```bash
npm run build
```

### Linting & formatting shortcuts

```bash
npm run lint:fix
npm run format
npm run check
npm run fix
```

VS Code users should enable the ESLint (`ms-vscode.vscode-eslint`) and Prettier (`esbenp.prettier-vscode`) extensions to match the project’s formatting rules.

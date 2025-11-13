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
| `autoAnswer` / `autoAcceptAnswer` | `true`                                                       | Turn off to manually call `acceptOffer` or `acceptAnswer`.                    |
| `rtcConfig`                       | Google STUN servers                                          | Merge with your own TURN/STUN list per peer connection.                       |
| `rtcOfferOptions`                 | `{ offerToReceiveAudio: false, offerToReceiveVideo: false }` | Provide custom `RTCOfferOptions` when creating offers.                        |
| `dataChannelConfig`               | `undefined`                                                  | Configure data channel count, init options, and callback.                     |
| `mediaChannelConfig`              | `undefined`                                                  | Attach local media streams and handle remote tracks.                          |

Partial configs are merged with `DEFAULT_CONFIG`, so you only set what you need.

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
      if (channel.label === "data-0") channel.onmessage = handleControl;
      if (channel.label === "data-1") channel.onmessage = handleRealtime;
      if (channel.label === "data-2") channel.onmessage = handleFileChunk;
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
- `joinIPHub(id, peerMetadata?)`
- `createRandomHub(peerMetadata?, hubMetadata?)`
- `joinRandomHub(id, peerMetadata?)`

Each call issues a WebSocket handshake to `/v1/...` endpoints on the ZeroHub server. Metadata objects are serialized and shared with other peers upon connection.

## Topology customization

The SDK ships with `MeshTopology`, which compares numeric peer IDs to avoid offer glare. To implement a different strategy (e.g., SFU coordination), implement the `Topology` interface in `client/src/topology` and pass an instance as the third argument of `ZeroHubClient`.

```ts
import { MeshTopology } from "@zero-hub/client";

const client = new ZeroHubClient(hosts, config, new MeshTopology());
```

## Reconnection & host failover

- Provide multiple hosts: `['sg1.zerohub.dev', 'sg2.zerohub.dev']`.
- When a WebSocket closes unexpectedly, the client invokes `getZeroHubBackupHost()` and reconnects automatically.
- Listen to `onZeroHubError` to surface unrecoverable errors to the user interface.

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

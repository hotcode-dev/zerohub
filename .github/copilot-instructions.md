# ZeroHub Development Guide

## Project Overview

ZeroHub is a WebRTC signaling server with TypeScript/JavaScript SDK. It enables peer-to-peer connections by facilitating SDP (Session Description Protocol) exchange via WebSocket. The monorepo contains:

- **client/** - TypeScript SDK (`@zero-hub/client` on npm)
- **server/** - Go signaling server
- **proto/** - Protobuf definitions for client-server communication
- **test/** - E2E tests using Playwright with Svelte components
- **docs/** - Astro-based documentation site
- **zerohub-share/** - Reference implementation (file sharing app)
- **zerohub-examples/** - Example implementations (JavaScript, Svelte)

## Architecture

### Core WebRTC Flow

1. **Signaling**: Client connects to ZeroHub server via WebSocket (`/hub/create` or `/hub/join`)
2. **Hub Management**: Server manages hubs (rooms) and peers within them
3. **SDP Exchange**: Server relays offers/answers between peers using Protobuf messages
4. **P2P Connection**: Peers establish direct WebRTC connections (data channels or media streams)
5. **Mesh Topology**: Default topology where each peer connects to every other peer

### Key Client Concepts

- **Peer Metadata**: Custom JSON metadata attached to each peer (e.g., `{ name: string }`)
- **Hub Metadata**: Custom JSON metadata attached to each hub
- **Peer Status Lifecycle**: `Pending → Offering → Answering → Connected`
- **Topology Pattern**: Pluggable topology system (currently `MeshTopology` only)
- **Offer Collision Avoidance**: Higher peer ID creates offer to lower peer ID

### Data Transfer Types

1. **Data Channels**: RTCDataChannel over SCTP/DTLS for arbitrary data
2. **Media Streams**: RTP/SRTP for audio/video
3. **Signaling Data**: Metadata exchanged via WebSocket

## Development Workflows

### Protocol Buffer Changes

```bash
make proto-gen  # Regenerates client/src/proto/* and server/pkg/proto/*
```

Always regenerate after modifying `proto/*.proto`. Client uses `ts-proto`, server uses `protoc-gen-go`.

### Client Development

```bash
cd client
npm run build      # Build ESM, CJS, and types to dist/
npm run lint:fix   # Auto-fix ESLint issues (flat config)
npm run format     # Format with Prettier (excludes proto/)
npm run check      # Lint + format check + TypeScript
```

Build outputs:
- `dist/esm/` - ES modules
- `dist/cjs/` - CommonJS
- `dist/types/` - TypeScript declarations

### Server Development

```bash
cd server
go run cmd/server.go                      # Default port 8080
APP_PORT=8081 go run cmd/server.go        # Custom port
go test -v ./...                          # Run tests
go test -bench ./pkg/*** -benchmem        # Benchmarks
```

Environment: Copy `.env.example` to `.env`. Key vars: `APP_PORT`, `APP_CLIENT_SECRET`.

### Testing

```bash
make test-all  # Spawns 2 servers + runs E2E tests (parallel with -j3)
cd test && npm run test  # Playwright component tests only
```

E2E tests use Svelte components that instantiate `ZeroHubClient` to verify connection flows.

### Mocking (Go)

```bash
make server-mock  # Generate mocks using gomock
```

Regenerate after interface changes in `pkg/zerohub/zerohub.go`, `pkg/hub/hub.go`, or `pkg/peer/peer.go`.

## Code Patterns

### Client SDK Usage

```typescript
import { ZeroHubClient, PeerStatus, LogLevel } from '@zero-hub/client';

const client = new ZeroHubClient<PeerMetadata, HubMetadata>(
  ['localhost:8080'],
  {
    tls: false,
    logLevel: LogLevel.Debug,
    dataChannelConfig: {
      numberOfChannels: 1,  // Create N channels per peer
      rtcDataChannelInit: { ordered: true },
      onDataChannel: (peer, dataChannel, isOwner) => {
        dataChannel.onmessage = (e) => console.log(e.data);
      }
    },
    mediaChannelConfig: {  // Optional for A/V
      localStream: myMediaStream,
      onTrack: (peer, event) => handleRemoteStream(event.streams[0])
    }
  }
);

client.onHubInfo = (hubInfo) => { /* hub created/joined */ };
client.onPeerStatusChange = (peer) => {
  if (peer.status === PeerStatus.Connected) {
    // Direct WebRTC connection established
  }
};

// Auto-generates UUID if hubId not provided
client.createHub('my-hub', { name: 'Alice' }, { hubName: 'Test Hub' });
// or
client.joinHub('my-hub', { name: 'Bob' });
```

### Multiple Data Channels Pattern

Use multiple channels per peer for separation of concerns:

```typescript
dataChannelConfig: {
  numberOfChannels: 3,  // Creates "data-0", "data-1", "data-2"
  onDataChannel: (peer, dc, isOwner) => {
    if (dc.label === 'data-0') {
      // Ordered/reliable for critical messages
      dc.onmessage = handleControl;
    } else if (dc.label === 'data-1') {
      // Unordered for real-time position updates
      dc.onmessage = handleRealtime;
    } else if (dc.label === 'data-2') {
      // File transfer chunks
      dc.onmessage = handleFileChunk;
    }
  }
}
```

### Reference Implementation Pattern (zerohub-share)

Study `zerohub-share/src/components/SharePage.svelte`:
- Protobuf messages for file metadata and chunks (`Message.encode/decode`)
- Encryption with `crypto.ts` (AES-GCM with password or shared key)
- Progress tracking via `ReceiveEvent` messages
- Avatar generation per peer using `@dicebear/core`

### Topology Implementation

Extend `Topology` interface (see `client/src/topology/`):

```typescript
export class MeshTopology implements Topology {
  onPeerStatusChange(peer: Peer) {
    const isOfferer = parseInt(peer.id) > parseInt(this.zeroHub.myPeerId);
    if (peer.status === PeerStatus.Pending) {
      if (isOfferer) {
        // Create data channels and send offer
      } else {
        // Set up ondatachannel handler
      }
    }
  }
}
```

Offerer creates channels; answerer receives via `ondatachannel`. This avoids race conditions.

## Project Conventions

### TypeScript/Client

- **Generic Types**: Always specify `<PeerMetadata, HubMetadata>` when metadata differs from `object`
- **Callbacks**: Use optional callbacks (`onHubInfo?`, `onPeerStatusChange?`) for event handling
- **Logging**: Use `ZeroHubLogger` abstraction (respects `logLevel` config)
- **Proto Imports**: Never manually edit `src/proto/*` - regenerate via Makefile

### Go/Server

- **Package Structure**: `cmd/` for entry points, `pkg/` for libraries
- **Interfaces**: Define interfaces in their own package (e.g., `pkg/peer/peer.go`)
- **Storage**: Pluggable storage via `pkg/storage/` interface (Memory, Gache implementations)
- **Error Handling**: Use `zerolog` for structured logging
- **WebSocket**: Use `fasthttp/websocket` library

### Common Pitfalls

1. **Peer ID Comparison**: Always use `parseInt()` when comparing peer IDs for offer/answer logic
2. **ICE Candidates**: Wait for `waitIceCandidatesTimeout` before sending offer/answer (default 2000ms)
3. **Auto-answer**: Default is `true`; set `autoAnswer: false` if manual offer handling needed
4. **Proto Changes**: Breaking changes require client SDK version bump
5. **Cross-workspace**: Use relative imports in test/examples (`../../../client/src/index`)

## Deployment Notes

- **Zero-downtime**: Use `/admin/migrate?host=new-instance.com` to route new connections to new server while existing connections drain
- **No Multi-instance**: ZeroHub doesn't support clustering (yet) - use proxy for migration
- **STUN/TURN**: Client defaults to Google STUN servers; override via `rtcConfig`
- **TLS**: Set `tls: true` in client config for production (`wss://`)

## Useful Commands

```bash
# Full test cycle
make test-all

# Kill running servers
make kill-server

# Client documentation
cd client && npm run docs

# Server benchmarks
cd server && go test -bench ./pkg/hub -benchmem -benchtime=1000x
```

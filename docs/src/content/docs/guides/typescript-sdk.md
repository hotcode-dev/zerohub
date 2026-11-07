---
title: TypeScript SDK
description: ZeroHub JavaScript/TypeScript Client SDK
---

The ZeroHub provides a TypeScript Client SDK to make it simple and type-safe to use the API.

## Installation

```bash
npm install @zero-hub/client
```

## Usage

Import the SDK and initialize the client

```typescript
import { ZeroHubClient, LogLevel } from "@zero-hub/client";

const zh = new ZeroHubClient(
  // ZeroHub hosts
  ["sg1.zerohub.dev"],
  // ZeroHub configs
  {
    logLevel: LogLevel.Debug,
    // if data channel config is set, zerohub will automatically create the data channel to other peers
    dataChannelConfig: {
      // add callback to create datachannel before making connection
      onDataChannel: (peer, dataChannel, isOwner) => {
        // handle all data channel to receive the message from the peer
        dataChannel.onmessage = (ev: MessageEvent) => {
          console.log(`Pong from ${peer.id}: ${ev.data}`);
        };
        // send message to the peer though WebRTC data channel
        dataChannel.send(`Ping to ${peer.id}`);
      },
    },
  }
);
```

## Topologies

The SDK ships with two built-in topologies. Choose one by passing an instance as the third argument to the `ZeroHubClient` constructor — the default is `MeshTopology`:

```typescript
import { ZeroHubClient, LogLevel, MeshTopology, SFUTopology } from "@zero-hub/client";

// Mesh: every peer connects to every other peer (default)
const meshClient = new ZeroHubClient(hosts, { logLevel: LogLevel.Debug }, new MeshTopology());

// SFU: a star topology where one peer (by default the numerically lowest peer id)
// holds a connection to every client — more scalable for larger groups
const sfuClient = new ZeroHubClient(hosts, { logLevel: LogLevel.Debug }, new SFUTopology());
```

For a custom strategy, implement the `Topology` interface. See the [SDK reference](/api-reference/sdk#topologies-mesh-and-sfu) for details on how each built-in topology behaves.

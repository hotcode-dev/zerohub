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

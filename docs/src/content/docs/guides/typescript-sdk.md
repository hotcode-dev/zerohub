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
    dataChannelConfig: {
      // add callback to create datachannel before making connection
      onDataChannel: (peer, dataChannel, isOwner) => {
        // handle all data channel to receive the message from peers
        dataChannel.onmessage = (ev: MessageEvent) => {
          addChat(`Peer ${peer.id}: ${ev.data}`);
        };
        dataChannels.push(dataChannel);
      },
    },
  }
);
```

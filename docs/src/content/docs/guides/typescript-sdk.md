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
import { MeshTopology, ZeroHubClient, LogLevel } from "@zero-hub/client";

const zh = new ZeroHubClient(
  // ZeroHub hosts
  ["sg1.zerohub.dev"],
  // ZeroHub configs
  { logLevel: LogLevel.Debug },
  // define topology of multi peer
  new MeshTopology(undefined, (peer, dataChannel, isOwner) => {
    // dataChannel is the dataChannel message from peer
    dataChannel.onmessage = (ev: MessageEvent) => {
      // event message from peers
    };
  })
);
```

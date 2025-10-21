---
title: Hub Types
description: Learn about different hub types in ZeroHub - Fixed Hub, Random Hub, and IP Hub
---

ZeroHub provides three different hub types to accommodate various use cases for peer-to-peer communication. Each hub type offers different characteristics in terms of identification, persistence, and access patterns.

## Overview

| Hub Type       | ID Source         | Use Case                                 | Persistence   |
| -------------- | ----------------- | ---------------------------------------- | ------------- |
| **Fixed Hub**  | User-defined      | Persistent rooms, organized spaces       | Manual        |
| **Random Hub** | Server-generated  | One-time sessions, temporary connections | Temporary     |
| **IP Hub**     | Client IP address | Location-based connections               | Session-based |

## Fixed Hub

Fixed hubs use user-defined identifiers, making them perfect for persistent rooms, organized spaces, or any scenario where you need predictable hub names.

### Creating a Fixed Hub

```typescript
import { ZeroHubClient } from "@zero-hub/client";

const client = new ZeroHubClient(["sg1.zerohub.dev"]);

// Create a new hub with a specific ID
client.createHub(
  "my-gaming-room", // Hub ID
  { username: "player1", level: 5 }, // Peer metadata
  { gameMode: "battle", maxPlayers: 4 } // Hub metadata
);
```

### Joining a Fixed Hub

```typescript
// Join an existing hub
client.joinHub(
  "my-gaming-room", // Hub ID to join
  { username: "player2", level: 3 } // Peer metadata
);
```

### Join or Create Pattern

For convenience, you can attempt to join a hub and create it if it doesn't exist:

```typescript
// Will join if exists, create if it doesn't
client.joinOrCreateHub(
  "my-gaming-room",
  { username: "player1", level: 5 }, // Peer metadata
  { gameMode: "battle", maxPlayers: 4 } // Hub metadata (only used if creating)
);
```

### Use Cases

- **Gaming rooms**: Create persistent game lobbies with memorable names
- **Team collaboration**: Set up dedicated spaces for teams or projects
- **Educational sessions**: Create classrooms or study groups
- **Conference rooms**: Virtual meeting spaces with consistent identifiers

## Random Hub

Random hubs use server-generated identifiers, perfect for temporary sessions where you don't need persistent room names.

### Creating a Random Hub

```typescript
// Create a hub with server-generated ID
client.createRandomHub(
  { username: "host", role: "presenter" }, // Peer metadata
  { sessionType: "presentation", duration: 60 } // Hub metadata
);

// The hub ID will be available in the hub info callback
client.onHubInfo = (hubInfo) => {
  console.log(`Created random hub: ${hubInfo.id}`);
  // Share this ID with other participants
};
```

### Joining a Random Hub

```typescript
// Join using the random ID provided by the creator
client.joinRandomHub(
  "abc123def456", // Random hub ID from creator
  { username: "participant", role: "viewer" } // Peer metadata
);
```

### Use Cases

- **Quick meetings**: Instant temporary meeting rooms
- **File sharing sessions**: One-time file transfer spaces
- **Debug sessions**: Temporary collaborative debugging
- **Event streaming**: Temporary broadcast rooms

## IP Hub

IP hubs use the client's IP address as the hub identifier, enabling automatic location-based or network-based grouping.

### Creating/Joining an IP Hub

```typescript
// Automatically use your IP as the hub ID
client.joinOrCreateIPHub(
  { username: "local_user", device: "laptop" }, // Peer metadata
  { network: "office_wifi", location: "building_a" } // Hub metadata
);
```

### Joining a Specific IP Hub

```typescript
// Join a specific IP-based hub
client.joinIPHub(
  "192.168.1.1", // Specific IP address
  { username: "remote_user", device: "mobile" } // Peer metadata
);
```

### Use Cases

- **Local network communication**: Connect devices on the same network
- **Location-based services**: Group users by geographical location
- **IoT device coordination**: Coordinate devices within the same network
- **Office collaboration**: Connect colleagues on the same office network

## Hub Metadata vs Peer Metadata

Understanding the difference between hub metadata and peer metadata is crucial for effective use:

### Hub Metadata

- **Scope**: Shared across all peers in the hub
- **Purpose**: Describes the hub's characteristics, settings, or rules
- **Persistence**: Set when the hub is created
- **Examples**: Game rules, room settings, session type

```typescript
const hubMetadata = {
  gameMode: "capture_the_flag",
  maxPlayers: 8,
  difficulty: "hard",
  rules: ["no-camping", "friendly-fire-off"],
};
```

### Peer Metadata

- **Scope**: Individual to each peer
- **Purpose**: Describes the peer's characteristics, preferences, or state
- **Persistence**: Can be updated when joining
- **Examples**: Username, preferences, capabilities

```typescript
const peerMetadata = {
  username: "player123",
  avatar: "knight",
  level: 25,
  preferredRole: "healer",
  capabilities: ["voice-chat", "screen-share"],
};
```

## Event Handling

Regardless of hub type, you can listen for hub and peer events:

```typescript
// Hub information received
client.onHubInfo = (hubInfo) => {
  console.log(`Connected to hub: ${hubInfo.id}`);
  console.log("Hub metadata:", hubInfo.metadata);
  console.log("Created at:", hubInfo.createdAt);
};

// Peer status changes
client.onPeerStatusChange = (peer) => {
  console.log(`Peer ${peer.id} status: ${peer.status}`);
  console.log("Peer metadata:", peer.metadata);
};

// Handle errors
client.onZeroHubError = (error) => {
  console.error("ZeroHub error:", error);
};
```

## Best Practices

### Choosing the Right Hub Type

1. **Use Fixed Hubs when**:

   - You need persistent, named rooms
   - Users need to remember or bookmark specific hubs
   - You want organized, structured spaces

2. **Use Random Hubs when**:

   - Creating temporary, one-time sessions
   - You need secure, unpredictable identifiers
   - Sessions don't need to be discoverable

3. **Use IP Hubs when**:
   - Building location-aware applications
   - Coordinating devices on the same network
   - Automatic peer discovery is desired

### Metadata Design

- Keep metadata lightweight and JSON-serializable
- Use hub metadata for shared configuration
- Use peer metadata for individual characteristics
- Consider privacy when sharing metadata

### Error Handling

Always implement proper error handling for robust applications:

```typescript
client.onZeroHubError = (error) => {
  console.error("Connection error:", error);
  // Implement reconnection logic
  // Show user-friendly error messages
  // Fall back to alternative hubs
};

client.onPeerError = (peer, error) => {
  console.error(`Peer ${peer.id} error:`, error);
  // Handle peer-specific errors
  // Attempt peer reconnection
};
```

## Advanced Configuration

You can customize the behavior of any hub type:

```typescript
const client = new ZeroHubClient(
  ["sg1.zerohub.dev"], // Multiple hosts for failover
  {
    logLevel: LogLevel.Warning,
    autoAnswer: true, // Automatically answer WebRTC offers
    autoAcceptAnswer: true, // Automatically accept WebRTC answers
    waitIceCandidatesTimeout: 3000, // ICE candidate timeout
    tls: true, // Use TLS/WSS
  }
);
```

This flexibility allows you to fine-tune ZeroHub's behavior for your specific application requirements.

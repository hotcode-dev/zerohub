# Zerohub

A WebRTC signaling server for trading session between peers design for minimal and simple.

## Features

- Multipeers WebRTC signaling server
- Transfers Session Description Protocol (SDP) over WebSocket (RFC6455)
- Peer Meta data for specific use cases
- TypeScript/JavaScript client SDK
- Rate Limitter (TODO)
- Error handling and recovery (TODO)
- Mesh, Star, MCU, or SFU topologies by example (TODO)
- Pre-generate SDP Offer (TODO)
- OAuth2 By GigaAuth (TODO)
- Trickle ICE (TODO)

## Structure

```mermaid
```

## API Reference

### WebSocket Handshake

In WebSocket protocol, Clients need to do handshake using HTTP before upgrading to WebSocket.

There are endpoints to connect the ZeroHub websocket, User can create hub or join exists hub by Hub ID.

```mermaid
sequenceDiagram
    participant Client
    participant Server
    Client->>Server: GET /hub/create HTTP/1.1
    Client->>Server: Upgrade: websocket
    Client->>Server: Connection: Upgrade
    Client->>Server: Sec-WebSocket-Key: [random_key]
    Client->>Server: Sec-WebSocket-Version: 13
    Server->>Client: HTTP/1.1 101 Switching Protocols
    Server->>Client: Upgrade: websocket
    Server->>Client: Connection: Upgrade
    Server->>Client: Sec-WebSocket-Accept: [hashed_key]
    Note over Client,Server: Connection is now a WebSocket connection
```

#### Create Hub

`WSS /hub/create`

#### Join Hub

`WSS /hub/join`

### WebSocket Message

The WebSocket is transfering message using Protobuf serialization.

After connecting to the Zerohub WebSocket server the client need to handle the websocket message.

### Zero Downtime Deployment

because ZeroHub do not support multi instance so it required the API proxy to change the path to the new server for the upcoming user while the old server still running until all the WebSocket connections are gone.

```mermaid

```

### Network Topology

In the context of WebRTC, topologies refer to the arrangement of participants and the flow of media streams within a WebRTC session. Different topologies offer varying levels of scalability, latency, and resilience, making them suitable for different use cases.

#### Mesh Topology

In a mesh topology, each participant directly connects to every other participant in the session. This results in a highly decentralized network with no single point of failure. However, it also increases bandwidth consumption and signaling complexity as the number of participants grows.

Advantages:

- High scalability: Can handle a large number of participants without relying on centralized servers.

- Resilience to server failures: Communication remains even if some participants are unavailable.

Disadvantages:

- High bandwidth consumption: Each participant sends and receives media streams to all other participants.

- Complex signaling: Requires efficient mechanisms to manage peer connections and maintain the mesh structure.

#### Star Topology

In a star topology, all participants connect to a central server, which acts as a hub for media streams. This simplifies signaling and reduces bandwidth consumption, but it also introduces a single point of failure.

Advantages:

- Reduced bandwidth consumption: Media streams are routed through the central server, optimizing bandwidth usage.

- Simplified signaling: Signaling is handled by the central server, reducing complexity for individual peers.

- Reduced CPU and battery drain: Central server handles media processing, reducing the workload on participants' devices.

Disadvantages:

- Centralized control: Reliance on a central server introduces a potential single point of failure.

- Increased latency: Media streams must travel to and from the central server, potentially increasing latency.

#### MCU (Multipoint Control Unit) Topology

An MCU topology employs a specialized server called a Multipoint Control Unit (MCU) to manage media streams and signaling. The MCU mixes and transcodes media streams to ensure compatibility across different devices and networks, making it suitable for large-scale conferences.

Advantages:

- Centralized mixing and transcoding: MCU ensures compatibility across diverse devices and networks.

- Improved scalability: MCU can handle a large number of participants efficiently.

Disadvantages:

- High infrastructure cost: MCUs are expensive to deploy and maintain.

- Increased latency: Centralized processing can introduce latency, especially for geographically dispersed participants.

#### SFU (Selective Forwarding Unit) Topology

An SFU topology utilizes a Selective Forwarding Unit (SFU) server to selectively route media streams between participants. This reduces bandwidth consumption compared to a mesh topology while maintaining low latency.

Advantages:

- Reduced latency: Media streams are forwarded directly between participants, minimizing latency.

- Scalability: SFU can handle a large number of participants without centralized processing, reducing infrastructure costs.

- Flexibility: SFU can be deployed in various configurations, including cloud-based or on-premises.

Disadvantages:

- Increased complexity: Requires more sophisticated signaling and media routing mechanisms compared to MCU.

- Potential for quality issues: Individual participants may need to transcode media streams if their devices are incompatible.

Choosing the right topology depends on the specific requirements of the WebRTC application. For small-scale, low-latency applications, a mesh or SFU topology may be suitable. For larger conferences with diverse participants, MCU or SFU topologies may be more appropriate.

## WebRTC data types

WebRTC supports three primary types of data transfer

1. Media Streams

Purpose: Real-time audio and video streams for communication and collaboration.

Transfer: RTP (Real-Time Transport Protocol) over SRTP (Secure RTP) for encryption and authentication.

Examples: WebRTC video calls, live streaming, screen sharing.

2. Data Channels

Purpose: Bidirectional channels for exchanging text, binary data, and other information.

Transfer: SCTP (Stream Control Transmission Protocol) over DTLS (Datagram Transport Layer Security) for encryption and authentication.

Examples: File transfer, chat applications, real-time data exchange between devices.

3. Application Data

Purpose: Custom data formats exchanged through signaling channels for application-specific purposes.

Transfer: Typically JSON or other structured formats over the signaling channel (usually WebSockets).

Examples: Negotiating game rules, exchanging game state updates, sending control messages.

Key Points:

- Each data transfer type has its own use cases, performance characteristics, and security considerations.

- WebRTC provides APIs for establishing and managing each type of data transfer.

- The choice of data transfer type depends on the specific requirements of your application.

## Factors for choosing the best hub

Bandwidth: Choose the peer with the highest upload bandwidth to handle the data stream efficiently. You can utilize WebRTC APIs like RTCPeerConnection.getSenders() and RTCSentBitrate to measure individual peer bandwidth.

CPU and memory resources: The hub peer needs to handle data aggregation and transmission, so consider peers with ample CPU and memory to avoid performance bottlenecks.

Network latency: Minimize overall latency by selecting the peer with the lowest average ping time to other peers. You can use WebRTC's RTCPingMeasurement API for this.

Connection stability: Prioritize peers with a stable and reliable internet connection to minimize dropped packets and disruptions. Monitoring connection quality metrics like packet loss and jitter can help.

Geographic location: If relevant to your application, consider the hub peer's location relative to other peers to optimize routing and minimize geographic latency.

Approaches for finding the best hub:

Dynamic selection: Continuously monitor peer resource availability and network metrics like bandwidth and latency. Implement an algorithm that automatically selects the most suitable peer as the hub based on real-time data.

Manual selection: Analyze offline data like individual peer resource limitations and network topology before starting the session. Based on this analysis, manually designate the most suitable peer as the hub.

Hybrid approach: Combine elements of both methods. Start with a pre-selected or manually chosen hub, but have a secondary selection process based on real-time performance metrics in case the chosen hub experiences issues.

# Files

- [Architecture Overview](overview.md) - End-to-end explanation of how ZeroHub's Go signaling server, TypeScript client SDK, protobuf wire protocol, and pluggable storage cooperate to turn a hub join into a direct peer-to-peer WebRTC connection.
- [Signaling Protocol & Peer Lifecycle](signaling-protocol.md) - The ZeroHub client/server protobuf wire format, the SDP offer/answer exchange and offer-collision rule, ICE candidate flushing, and the full PeerStatus lifecycle that drives peer negotiation.

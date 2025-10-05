import { PeerStatus } from "./types";

/**
 * Represents a peer in a WebRTC connection.
 * @template PeerMetadata - The type of metadata associated with the peer.
 * @property {string} id - The unique identifier of the peer.
 * @property {PeerStatus} status - The current status of the peer.
 * @property {PeerMetadata} metadata - Metadata associated with the peer.
 * @property {Date} joinedAt - The timestamp when the peer joined.
 * @property {RTCPeerConnection} rtcConn - The WebRTC connection object for the peer.
 */
export class Peer<PeerMetadata = object> {
  public id: string;
  public status: PeerStatus;
  public metadata: PeerMetadata;
  public joinedAt: Date;
  public rtcConn: RTCPeerConnection;

  constructor(
    id: string,
    status: PeerStatus,
    metadata: PeerMetadata,
    joinedAt: Date,
    rtcConn: RTCPeerConnection
  ) {
    this.id = id;
    this.status = status;
    this.metadata = metadata;
    this.joinedAt = joinedAt;
    this.rtcConn = rtcConn;
  }
}

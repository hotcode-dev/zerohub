import { PeerStatus } from "./types";

/**
 * Represents a peer in a WebRTC connection.
 * @typeParam PeerMetadata - The type of metadata associated with the peer.
 */
export class Peer<PeerMetadata = object> {
  public id: string;
  public status: PeerStatus;
  public metadata: PeerMetadata;
  public joinedAt: Date;
  public rtcConn: RTCPeerConnection;

  /**
   * Creates a new Peer instance.
   * @param id - The unique identifier of the peer.
   * @param status - The current status of the peer.
   * @param metadata - Metadata associated with the peer.
   * @param joinedAt - The timestamp when the peer joined.
   * @param rtcConn - The WebRTC connection object for the peer.
   */
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

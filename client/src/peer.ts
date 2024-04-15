import { PeerStatus } from "./types";

export class Peer<PeerMetadata = object> {
  public id: number;
  public status: PeerStatus;
  public metadata: PeerMetadata;
  public joinedAt: Date;
  public rtcConn: RTCPeerConnection;

  constructor(
    id: number,
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

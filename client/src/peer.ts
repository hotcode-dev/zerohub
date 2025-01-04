import { PeerStatus } from "./types";

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

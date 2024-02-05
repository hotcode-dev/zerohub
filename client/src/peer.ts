import { PeerStatus } from "./types";

export class Peer<PeerMetaData = object> {
  id: number;
  status: PeerStatus;
  metaData: PeerMetaData;
  joinedAt: Date;
  rtcConn: RTCPeerConnection;

  constructor(
    id: number,
    status: PeerStatus,
    metaData: PeerMetaData,
    joinedAt: Date,
    rtcConn: RTCPeerConnection
  ) {
    this.id = id;
    this.status = status;
    this.metaData = metaData;
    this.joinedAt = joinedAt;
    this.rtcConn = rtcConn;
  }
}

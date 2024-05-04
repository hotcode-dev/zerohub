export enum PeerStatus {
  Pending = "pending", // waiting for remote or local peer to create an offer.
  Offering = "offering", // offering, waiting for remote peer to answer.
  AnswerPending = "answer_pending", // got an offer from remote peer, waiting for local peer to answer.
  Answering = "answering", // answering, waiting for remote peer to accept.
  AcceptPending = "accept_pending", // got an answer from remote peer, waiting for local peer to accept.
  Connected = "connected", // the remote peer is connected to local peer
  WebRTCDisconnected = "webrtc_disconnected", // the remote peer WebRTC disconnected to local peer
  ZeroHubDisconnected = "zerohub_disconnected", // the remote peer disconnected to ZeroHub
}

export enum LogLevel {
  Debug = "debug",
  Warning = "warning",
  Error = "error",
  None = "none",
}

export interface Config {
  tls: boolean;
  logLevel: LogLevel;
  waitIceCandidatesTimeout: number;
  autoAnswer: boolean;
  autoAcceptAnswer: boolean;
}

export interface HubInfo<HubMetadata = object> {
  id: string;
  metadata: HubMetadata;
  createdAt: Date;
}

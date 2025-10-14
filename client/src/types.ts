import { Logger } from "./logger";
import { Peer } from "./peer";

/**
 * The status of a peer connection.
 * - Pending: waiting for remote or local peer to create an offer.
 * - Offering: offering, waiting for remote peer to answer.
 * - AnswerPending: got an offer from remote peer, waiting for local peer to answer.
 * - Answering: answering, waiting for remote peer to accept.
 * - AcceptPending: got an answer from remote peer, waiting for local peer to accept.
 * - Connected: the remote peer is connected to local peer.
 * - WebRTCDisconnected: the remote peer WebRTC disconnected to local peer.
 * - ZeroHubDisconnected: the remote peer disconnected to ZeroHub.
 */
export enum PeerStatus {
  Pending = "pending",
  Offering = "offering",
  AnswerPending = "answer_pending",
  Answering = "answering",
  AcceptPending = "accept_pending",
  Connected = "connected",
  WebRTCDisconnected = "webrtc_disconnected",
  ZeroHubDisconnected = "zerohub_disconnected",
}

/**
 * Log level for the ZeroHub client.
 * - LogLevel.Debug will log all messages.
 * - LogLevel.Warning will log only warnings and errors.
 * - LogLevel.Error will log only errors.
 * - LogLevel.None will not log any messages.
 * Default is LogLevel.Warning.
 */
export enum LogLevel {
  Debug = "debug",
  Warning = "warning",
  Error = "error",
  None = "none",
}

/**
 * Configuration for data channels.
 * If provided, it will create a data channel for each peer when they connect.
 * @template PeerMetadata - The type of metadata associated with the peer.
 */
export interface DataChannelConfig<PeerMetadata = object> {
  rtcDataChannelInit?: RTCDataChannelInit;
  onDataChannel: (
    peer: Peer<PeerMetadata>,
    dataChannel: RTCDataChannel,
    /**
     * true if the local peer created the data channel,
     * false if remote peer created it
     */
    isOwnerDataChannel: boolean
  ) => void;
}

/**
 * Configuration for media channels.
 * If provided, it will create a media channel for each peer when they connect.
 * @template PeerMetadata - The type of metadata associated with the peer.
 */
export interface MediaChannelConfig<PeerMetadata = object> {
  localStream?: MediaStream;
  onTrack: (peer: Peer<PeerMetadata>, event: RTCTrackEvent) => void;
}

/**
 * Configuration for the ZeroHub client.
 * @template PeerMetadata - The type of metadata associated with the peer.
 */
export interface Config<PeerMetadata = object> {
  /**
   * Whether to use TLS (wss) to connect to ZeroHub server.
   * Default is true.
   */
  tls: boolean;
  /**
   * Log level for the ZeroHub client.
   * Default is LogLevel.Warning.
   * LogLevel.Debug will log all messages.
   * LogLevel.Warning will log only warnings and errors.
   * LogLevel.Error will log only errors.
   * LogLevel.None will not log any messages.
   * Default is LogLevel.Warning.
   */
  logLevel: LogLevel;
  /**
   * The logger to use for logging messages
   * based on the log level.
   * Default is console.
   */
  logger: Logger;
  /**
   * Timeout in milliseconds to wait for ICE candidates before sending the offer/answer.
   * Default is 2000 ms.
   */
  waitIceCandidatesTimeout: number;
  /**
   * Auto answer incoming offers from remote peers.
   * Default is true.
   * If false, you need to call `acceptOffer` manually.
   */
  autoAnswer: boolean;
  /**
   * Auto accept incoming answers from remote peers.
   * Default is true.
   * If false, you need to call `acceptAnswer` manually.
   */
  autoAcceptAnswer: boolean;
  /**
   * RTC configuration for the RTCPeerConnection.
   * Default is a configuration with Google's public STUN servers.
   */
  rtcConfig: RTCConfiguration;
  /**
   * RTC offer options for the mesh topology.
   * This can be used to customize the offer sent to peers.
   */
  rtcOfferOptions: RTCOfferOptions;
  /**
   * Configuration for data channels.
   * If provided, it will create a data channel for each peer when they connect.
   */
  dataChannelConfig?: DataChannelConfig<PeerMetadata>;
  /**
   * Configuration for media channels.
   * If provided, it will create a media channel for each peer when they connect.
   */
  mediaChannelConfig?: MediaChannelConfig<PeerMetadata>;
}

/**
 * Information about a hub.
 * @template HubMetadata - The type of metadata associated with the hub.
 */
export interface HubInfo<HubMetadata = object> {
  /**
   * The unique identifier of the hub.
   */
  id: string;
  /**
   * The metadata associated with the hub.
   */
  metadata: HubMetadata;
  /**
   * The timestamp when the hub was created.
   */
  createdAt: Date;
}

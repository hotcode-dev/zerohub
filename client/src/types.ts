import { Logger } from "./logger";
import { Peer } from "./peer";

/**
 * The status of a peer connection.
 */
export enum PeerStatus {
  /** Pending: waiting for remote or local peer to create an offer. */
  Pending = "pending",
  /** Offering: offering, waiting for remote peer to answer. */
  Offering = "offering",
  /** AnswerPending: got an offer from remote peer, waiting for local peer to answer. */
  AnswerPending = "answer_pending",
  /** Answering: answering, waiting for remote peer to accept. */
  Answering = "answering",
  /** AcceptPending: got an answer from remote peer, waiting for local peer to accept. */
  AcceptPending = "accept_pending",
  /** Connected: the remote peer is connected to local peer. */
  Connected = "connected",
  /** WebRTCDisconnected: the remote peer WebRTC disconnected to local peer. */
  WebRTCDisconnected = "webrtc_disconnected",
  /** ZeroHubDisconnected: the remote peer disconnected to ZeroHub.*/
  ZeroHubDisconnected = "zerohub_disconnected",
}

/**
 * Log level for the ZeroHub client.
 * Default is LogLevel.Warning.
 */
export enum LogLevel {
  /** LogLevel.Debug will log all messages. */
  Debug = "debug",
  /** LogLevel.Warning will log only warnings and errors. */
  Warning = "warning",
  /** LogLevel.Error will log only errors. */
  Error = "error",
  /** LogLevel.None will not log any messages. */
  None = "none",
}

/**
 * Configuration for data channels.
 * If provided, it will create data channel(s) for each peer when they connect.
 *
 * ## Multiple Channel Support
 *
 * ZeroHub supports creating multiple data channels per peer connection, which is useful for:
 * - **Separating data by priority**: Use different channels for critical vs non-critical data
 * - **Parallel data streams**: Send different types of data simultaneously (e.g., chat, file transfer, game state)
 * - **Performance optimization**: Distribute load across multiple channels with different reliability settings
 *
 * ### Single Channel (Default)
 * ```typescript
 * dataChannelConfig: {
 *   onDataChannel: (peer, dataChannel, isOwner) => {
 *     dataChannel.onmessage = (event) => console.log(event.data);
 *   }
 * }
 * ```
 *
 * ### Multiple Channels
 * ```typescript
 * dataChannelConfig: {
 *   numberOfChannels: 3, // Creates 3 channels per peer: "data-0", "data-1", "data-2"
 *   onDataChannel: (peer, dataChannel, isOwner) => {
 *     // Handle each channel based on its label
 *     if (dataChannel.label === "data-0") {
 *       // High priority/ordered channel for critical data
 *       dataChannel.onmessage = (event) => handleCriticalData(event.data);
 *     } else if (dataChannel.label === "data-1") {
 *       // Unordered channel for real-time updates
 *       dataChannel.onmessage = (event) => handleRealtimeUpdates(event.data);
 *     } else if (dataChannel.label === "data-2") {
 *       // Separate channel for file transfers
 *       dataChannel.onmessage = (event) => handleFileTransfer(event.data);
 *     }
 *   },
 *   rtcDataChannelInit: { ordered: true } // Applied to all channels
 * }
 * ```
 *
 * ### Channel Naming Convention
 * Channels are automatically named as `"data-{index}"` where index starts from 0.
 * You can identify channels using the `dataChannel.label` property.
 *
 * ### Use Cases
 * - **Gaming**: Separate channels for game state (ordered) and player positions (unordered, low-latency)
 * - **Collaboration tools**: Chat messages, cursor positions, and document edits on different channels
 * - **File sharing**: Control messages on one channel, file chunks on parallel channels
 * - **Streaming**: Metadata on ordered channel, data chunks on unordered channels
 *
 * @typeParam PeerMetadata - The type of metadata associated with the peer.
 */
export interface DataChannelConfig<PeerMetadata = object> {
  /**
   * The number of data channels to create per peer connection.
   * Each channel will be named "data-0", "data-1", etc.
   * Default is 1 (creates a single channel named "data-0").
   *
   * @remarks
   * - All channels use the same `rtcDataChannelInit` configuration
   * - Channels are created sequentially by the offerer
   * - The answerer receives `onDataChannel` callbacks as each channel is created
   * - Maximum practical limit is typically 5-10 channels per connection
   *
   * @example
   * ```typescript
   * numberOfChannels: 3 // Creates "data-0", "data-1", "data-2"
   * ```
   */
  numberOfChannels?: number;

  /**
   * RTCDataChannel initialization options applied to all channels.
   * Common options:
   * - `ordered`: Whether messages must arrive in order (default: true)
   * - `maxRetransmits`: Maximum number of retransmissions (for unreliable channels)
   * - `maxPacketLifeTime`: Maximum time to attempt retransmissions in milliseconds
   *
   * @example
   * ```typescript
   * // Ordered, reliable channel (default)
   * rtcDataChannelInit: { ordered: true }
   *
   * // Unordered, unreliable for low-latency
   * rtcDataChannelInit: { ordered: false, maxRetransmits: 0 }
   * ```
   */
  rtcDataChannelInit?: RTCDataChannelInit;

  /**
   * Callback invoked when a data channel is created or received.
   * Called once for each channel specified in `numberOfChannels`.
   *
   * @param peer - The peer associated with this data channel
   * @param dataChannel - The RTCDataChannel instance (use `dataChannel.label` to identify)
   * @param isOwnerDataChannel - true if the local peer created the channel, false if received from remote peer
   *
   * @example
   * ```typescript
   * onDataChannel: (peer, dataChannel, isOwner) => {
   *   console.log(`Channel ${dataChannel.label} ${isOwner ? 'created' : 'received'}`);
   *   dataChannel.onopen = () => console.log(`${dataChannel.label} open`);
   *   dataChannel.onmessage = (event) => handleMessage(dataChannel.label, event.data);
   * }
   * ```
   */
  onDataChannel: (
    peer: Peer<PeerMetadata>,
    dataChannel: RTCDataChannel,
    isOwnerDataChannel: boolean
  ) => void;
}

/**
 * Configuration for media channels.
 * If provided, it will create a media channel for each peer when they connect.
 * @typeParam PeerMetadata - The type of metadata associated with the peer.
 */
export interface MediaChannelConfig<PeerMetadata = object> {
  localStream?: MediaStream;
  onTrack: (peer: Peer<PeerMetadata>, event: RTCTrackEvent) => void;
}

/**
 * Configuration for the ZeroHub client.
 * @typeParam PeerMetadata - The type of metadata associated with the peer.
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
 * @typeParam HubMetadata - The type of metadata associated with the hub.
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

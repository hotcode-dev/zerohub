import { ZeroHubLogger } from "../logger";
import { Peer } from "../peer";
import { Config } from "../types";

/**
 * Sets up data channel handling for a peer's RTCPeerConnection, shared by all
 * topologies.
 *
 * - Offerer: creates `numberOfChannels` (default 1) data channels with labels
 *   "0", "1", ... and invokes `onDataChannel` for each with `isOwner = true`.
 * - Answerer: installs `ondatachannel` so incoming channels invoke
 *   `onDataChannel` with `isOwner = false`.
 *
 * Does nothing when no `dataChannelConfig.onDataChannel` is configured.
 *
 * @param zeroHubConfig - The ZeroHub client configuration.
 * @param peer - The peer whose RTCPeerConnection is set up.
 * @param isOfferer - True if this peer creates the offer (and the channels).
 * @param logOnDataChannel - Optional answerer-only callback invoked when an
 *   incoming data channel is received, used by topologies that log it.
 */
export function setupDataChannel<T>(
  zeroHubConfig: Config<T>,
  peer: Peer<T>,
  isOfferer: boolean,
  logOnDataChannel?: () => void
): void {
  if (!zeroHubConfig.dataChannelConfig?.onDataChannel) {
    return;
  }

  const onDataChannel = zeroHubConfig.dataChannelConfig.onDataChannel;

  if (isOfferer) {
    // create data channels
    const numberOfChannels =
      zeroHubConfig.dataChannelConfig.numberOfChannels || 1;
    for (let i = 0; i < numberOfChannels; i++) {
      const dataChannel = peer.rtcConn.createDataChannel(
        i.toString(),
        zeroHubConfig.dataChannelConfig.rtcDataChannelInit
      );
      onDataChannel(peer, dataChannel, true);
    }
  } else {
    // handle incoming data channel
    peer.rtcConn.ondatachannel = (event) => {
      if (event.channel) {
        logOnDataChannel?.();
        onDataChannel(peer, event.channel, false);
      }
    };
  }
}

/**
 * Sets up media stream handling for a peer's RTCPeerConnection, shared by all
 * topologies: adds the configured `localStream` tracks to the connection and
 * installs the `ontrack` handler that invokes `mediaChannelConfig.onTrack`.
 *
 * Does nothing when no `mediaChannelConfig` is configured.
 *
 * @param zeroHubConfig - The ZeroHub client configuration.
 * @param peer - The peer whose RTCPeerConnection is set up.
 * @param logger - The log-level-gated logger to log through. Call sites must
 *   pass the gated `ZeroHubClient.logger` (a `ZeroHubLogger`), not the raw
 *   user `config.logger`, so log-level gating is preserved.
 * @param logOnAddTrack - Optional callback invoked before each local
 *   `addTrack` call, used by topologies that log outgoing tracks.
 * @param logOnTrack - Optional callback invoked before every `onTrack`
 *   invocation, used by topologies that log incoming tracks.
 */
export function setupMediaChannel<T>(
  zeroHubConfig: Config<T>,
  peer: Peer<T>,
  logger: ZeroHubLogger,
  logOnAddTrack?: (logger: ZeroHubLogger, peer: Peer<T>) => void,
  logOnTrack?: (logger: ZeroHubLogger, peer: Peer<T>) => void
): void {
  const mediaChannelConfig = zeroHubConfig.mediaChannelConfig;
  if (!mediaChannelConfig) {
    return;
  }

  // if local stream is available, add tracks to peer connection
  const localStream = mediaChannelConfig.localStream;
  if (localStream) {
    localStream.getTracks().forEach((track) => {
      logOnAddTrack?.(logger, peer);
      peer.rtcConn.addTrack(track, localStream);
    });
  }

  // handle incoming media stream
  peer.rtcConn.ontrack = (event) => {
    logOnTrack?.(logger, peer);
    mediaChannelConfig.onTrack(peer, event);
  };
}

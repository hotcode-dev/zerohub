import { Logger } from "../logger";
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
 */
export function setupDataChannel<T>(
  zeroHubConfig: Config<T>,
  peer: Peer<T>,
  isOfferer: boolean
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
 * @param logOnAddTrack - Optional callback invoked before each local
 *   `addTrack` call, used by topologies that log outgoing tracks.
 * @param logOnTrack - Optional callback invoked before every `onTrack`
 *   invocation, used by topologies that log incoming tracks.
 */
export function setupMediaChannel<T>(
  zeroHubConfig: Config<T>,
  peer: Peer<T>,
  logOnAddTrack?: (logger: Logger, peer: Peer<T>) => void,
  logOnTrack?: (logger: Logger, peer: Peer<T>) => void
): void {
  const mediaChannelConfig = zeroHubConfig.mediaChannelConfig;
  if (!mediaChannelConfig) {
    return;
  }

  // if local stream is available, add tracks to peer connection
  const localStream = mediaChannelConfig.localStream;
  if (localStream) {
    localStream.getTracks().forEach((track) => {
      logOnAddTrack?.(zeroHubConfig.logger, peer);
      peer.rtcConn.addTrack(track, localStream);
    });
  }

  // handle incoming media stream
  peer.rtcConn.ontrack = (event) => {
    logOnTrack?.(zeroHubConfig.logger, peer);
    mediaChannelConfig.onTrack(peer, event);
  };
}

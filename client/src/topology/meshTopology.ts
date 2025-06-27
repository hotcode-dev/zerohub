import { Peer } from "../peer";
import { PeerStatus } from "../types";
import { ZeroHubClient } from "../zeroHub";
import { Topology } from ".";

export interface DataChannelConfig<PeerMetadata = object> {
  rtcDataChannelInit?: RTCDataChannelInit;
  onDataChannel: (
    peer: Peer<PeerMetadata>,
    dataChannel: RTCDataChannel,
    isOwner: boolean
  ) => void;
}

export interface MediaChannelConfig<PeerMetadata = object> {
  localStream?: MediaStream;
  onTrack: (peer: Peer<PeerMetadata>, event: RTCTrackEvent) => void;
}

export interface MeshTopologyConfig<PeerMetadata = object> {
  rtcOfferOptions?: RTCOfferOptions;
  dataChannelConfig?: DataChannelConfig<PeerMetadata>;
  mediaChannelConfig?: MediaChannelConfig<PeerMetadata>;
}

export class MeshTopology<PeerMetadata = object, HubMetadata = object>
  implements Topology<PeerMetadata, HubMetadata>
{
  /**
   * The ZeroHub client instance.
   * This is initialized in the init method and used to manage peer connections.
   */
  zeroHub: ZeroHubClient<PeerMetadata, HubMetadata> | undefined;

  /**
   * RTC offer options for the mesh topology.
   * This can be used to customize the offer sent to peers.
   */
  rtcOfferOptions: RTCOfferOptions | undefined;

  /**
   * Configuration for data channels.
   * If provided, it will create a data channel for each peer when they connect.
   */
  dataChannelConfig: DataChannelConfig<PeerMetadata> | undefined;

  /**
   * Configuration for media channels.
   * If provided, it will create a media channel for each peer when they connect.
   */
  mediaChannelConfig: MediaChannelConfig<PeerMetadata> | undefined;

  constructor(config: MeshTopologyConfig<PeerMetadata> = {}) {
    this.rtcOfferOptions = config.rtcOfferOptions;
    this.dataChannelConfig = config.dataChannelConfig;
    this.mediaChannelConfig = config.mediaChannelConfig;
  }

  init(zeroHub: ZeroHubClient<PeerMetadata, HubMetadata>) {
    this.zeroHub = zeroHub;

    // override onPeerStatusChange to handle data channel
    const prevOnPeerStatusChange = this.zeroHub.onPeerStatusChange;
    this.zeroHub.onPeerStatusChange = (peer: Peer<PeerMetadata>) => {
      if (prevOnPeerStatusChange) prevOnPeerStatusChange(peer);
      this.onPeerStatusChange(peer);
    };
  }

  onPeerStatusChange(peer: Peer<PeerMetadata>) {
    switch (peer.status) {
      case PeerStatus.Connected:
        break;
      case PeerStatus.Pending:
        // if peer id is greater than local peer id, create offer
        if (this.zeroHub?.myPeerId && peer.id > this.zeroHub.myPeerId) {
          if (this.dataChannelConfig?.onDataChannel) {
            // create data channel
            const dataChannel = peer.rtcConn.createDataChannel(
              "data",
              this.dataChannelConfig.rtcDataChannelInit
            );
            this.dataChannelConfig.onDataChannel?.(peer, dataChannel, true);
          }

          // offer should send after create data channel
          this.zeroHub.sendOffer(peer.id, this.rtcOfferOptions);
        } else {
          if (this.dataChannelConfig?.onDataChannel) {
            // handle incoming data channel
            peer.rtcConn.ondatachannel = (event) => {
              this.dataChannelConfig?.onDataChannel?.(
                peer,
                event.channel,
                false
              );
            };
          }
        }

        // if media channel config is provided, set up media stream handling
        if (this.mediaChannelConfig) {
          // if local stream is available, add tracks to peer connection
          if (this.mediaChannelConfig.localStream) {
            this.mediaChannelConfig.localStream.getTracks().forEach((track) => {
              if (this.mediaChannelConfig?.localStream)
                peer.rtcConn.addTrack(
                  track,
                  this.mediaChannelConfig.localStream
                );
            });
          }

          // handle incoming media stream
          peer.rtcConn.ontrack = (event) => {
            this.mediaChannelConfig?.onTrack?.(peer, event);
          };
        }
        break;
      case PeerStatus.ZeroHubDisconnected:
        break;
    }
  }
}

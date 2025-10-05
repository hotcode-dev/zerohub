import { Peer } from "../peer";
import { PeerStatus } from "../types";
import { ZeroHubClient } from "../zeroHub";
import { Topology } from ".";

/**
 * MeshTopology implements a full mesh WebRTC topology.
 * Each peer connects to every other peer directly.
 * This is the simplest topology and is suitable for small groups of peers.
 * For larger groups, consider using a different topology such as SFU or MCU.
 * The MeshTopology handles peer status changes and sets up data channels and media streams as needed.
 * It uses the peer IDs to determine which peer should create the offer to avoid offer collisions.
 */
export class MeshTopology<PeerMetadata = object, HubMetadata = object>
  implements Topology<PeerMetadata, HubMetadata>
{
  /**
   * The ZeroHub client instance.
   * This is initialized in the init method and used to manage peer connections.
   */
  zeroHub: ZeroHubClient<PeerMetadata, HubMetadata> | undefined;

  init(zeroHub: ZeroHubClient<PeerMetadata, HubMetadata>) {
    this.zeroHub = zeroHub;

    // override onPeerStatusChange to handle data channel
    const prevOnPeerStatusChange = this.zeroHub.onPeerStatusChange;
    this.zeroHub.onPeerStatusChange = (peer: Peer<PeerMetadata>) => {
      if (prevOnPeerStatusChange) {
        prevOnPeerStatusChange(peer);
      }
      this.onPeerStatusChange(peer);
    };
  }

  onPeerStatusChange(peer: Peer<PeerMetadata>) {
    if (!this.zeroHub) {
      throw new Error("ZeroHub is not initialized");
    }

    switch (peer.status) {
      case PeerStatus.Connected:
        break;
      case PeerStatus.Pending:
        // if peer id is greater than local peer id, create offer
        if (this.zeroHub.myPeerId && peer.id > this.zeroHub.myPeerId) {
          if (this.zeroHub.config.dataChannelConfig?.onDataChannel) {
            // create data channel
            const dataChannel = peer.rtcConn.createDataChannel(
              "data",
              this.zeroHub.config.dataChannelConfig.rtcDataChannelInit
            );
            this.zeroHub.config.dataChannelConfig.onDataChannel?.(
              peer,
              dataChannel,
              true
            );
          }

          // offer should send after create data channel
          this.zeroHub
            .sendOffer(peer.id, this.zeroHub.config.rtcOfferOptions)
            .catch((err) => {
              this.zeroHub?.logger.error(
                "Failed to send offer to peer",
                peer.id,
                err
              );
            });
        } else {
          if (this.zeroHub.config.dataChannelConfig?.onDataChannel) {
            // handle incoming data channel
            peer.rtcConn.ondatachannel = (event) => {
              this.zeroHub?.config.dataChannelConfig?.onDataChannel?.(
                peer,
                event.channel,
                false
              );
            };
          }
        }

        // if media channel config is provided, set up media stream handling
        if (this.zeroHub.config.mediaChannelConfig) {
          // if local stream is available, add tracks to peer connection
          if (this.zeroHub.config.mediaChannelConfig.localStream) {
            this.zeroHub.config.mediaChannelConfig.localStream
              .getTracks()
              .forEach((track) => {
                if (this.zeroHub?.config.mediaChannelConfig?.localStream) {
                  peer.rtcConn.addTrack(
                    track,
                    this.zeroHub.config.mediaChannelConfig.localStream
                  );
                }
              });
          }

          // handle incoming media stream
          peer.rtcConn.ontrack = (event) => {
            this.zeroHub?.config.mediaChannelConfig?.onTrack?.(peer, event);
          };
        }
        break;
      case PeerStatus.ZeroHubDisconnected:
        break;
    }
  }
}

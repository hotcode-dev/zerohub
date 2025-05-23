import { Peer } from "../peer";
import { PeerStatus } from "../types";
import { ZeroHubClient } from "../zeroHub";
import { Topology } from ".";

export class MeshTopology<PeerMetadata = object, HubMetadata = object>
  implements Topology<PeerMetadata, HubMetadata>
{
  zeroHub: ZeroHubClient<PeerMetadata, HubMetadata> | undefined;
  dataChannelConfig: RTCDataChannelInit;

  onDataChannel?:
    | ((
        peer: Peer<PeerMetadata>,
        dataChannel: RTCDataChannel,
        isOwner: boolean
      ) => void)
    | undefined;

  constructor(
    dataChannelConfig: RTCDataChannelInit = {
      ordered: false,
    },
    onDataChannel?: (
      peer: Peer<PeerMetadata>,
      dataChannel: RTCDataChannel,
      isOwner: boolean
    ) => void
  ) {
    this.dataChannelConfig = dataChannelConfig;
    this.onDataChannel = onDataChannel;
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
          if (this.onDataChannel) {
            // create data channel
            const dataChannel = peer.rtcConn.createDataChannel(
              "data",
              this.dataChannelConfig
            );
            this.onDataChannel(peer, dataChannel, true);
          }

          // offer should send after create data channel
          this.zeroHub.sendOffer(peer.id);
        } else {
          if (this.onDataChannel) {
            // handle incoming data channel
            peer.rtcConn.ondatachannel = (event) => {
              this.onDataChannel?.(peer, event.channel, false);
            };
          }
        }
        break;
      case PeerStatus.ZeroHubDisconnected:
        break;
    }
  }
}

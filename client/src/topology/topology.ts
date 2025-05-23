import { Peer } from "../peer";
import { ZeroHubClient } from "../zeroHub";

// webrtc topology that will use to connect to other peers
export interface Topology<PeerMetadata = object, HubMetadata = object> {
  zeroHub: ZeroHubClient<PeerMetadata, HubMetadata> | undefined;

  init(zeroHub: ZeroHubClient<PeerMetadata, HubMetadata>): void;
  onDataChannel?:
    | ((
        peer: Peer<PeerMetadata>,
        dataChannel: RTCDataChannel,
        isOwner: boolean
      ) => void)
    | undefined;
}

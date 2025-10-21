import { Peer } from "../peer";
import { ZeroHubClient } from "../zeroHub";

/**
 * Interface for defining a topology strategy for peer connections.
 * @typeParam PeerMetadata - The type of metadata associated with the peer.
 * @typeParam HubMetadata - The type of metadata associated with the hub.
 */
export interface Topology<PeerMetadata = object, HubMetadata = object> {
  zeroHub: ZeroHubClient<PeerMetadata, HubMetadata> | undefined;

  init(zeroHub: ZeroHubClient<PeerMetadata, HubMetadata>): void;
  onPeerStatusChange(peer: Peer<PeerMetadata>): void;
}

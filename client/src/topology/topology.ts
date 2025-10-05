import { ZeroHubClient } from "../zeroHub";

/**
 * Interface for defining a topology strategy for peer connections.
 * @template PeerMetadata - The type of metadata associated with the peer.
 * @template HubMetadata - The type of metadata associated with the hub.
 */
export interface Topology<PeerMetadata = object, HubMetadata = object> {
  zeroHub: ZeroHubClient<PeerMetadata, HubMetadata> | undefined;

  init(zeroHub: ZeroHubClient<PeerMetadata, HubMetadata>): void;
}

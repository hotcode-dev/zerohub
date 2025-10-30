import { Peer } from "../peer";
import { PeerStatus } from "../types";
import { ZeroHubClient } from "../zeroHub";
import { Topology } from ".";

/**
 * SFUTopology implements a Selective Forwarding Unit topology.
 * In this topology, there is one designated peer (the SFU) that receives streams from all other peers
 * and forwards them selectively. This is more scalable than mesh topology for larger groups.
 * The SFU peer is typically the first peer to join the hub or can be explicitly designated.
 *
 * Benefits:
 * - More scalable than mesh topology (reduces bandwidth usage for clients)
 * - Better for larger groups (5+ participants)
 * - Lower CPU usage on client devices
 *
 * Trade-offs:
 * - Requires one peer to act as the SFU (higher bandwidth/CPU for that peer)
 * - Single point of failure if the SFU peer disconnects
 *
 * @typeParam PeerMetadata - The type of metadata associated with the peer.
 * @typeParam HubMetadata - The type of metadata associated with the hub.
 */
export class SFUTopology<PeerMetadata = object, HubMetadata = object>
  implements Topology<PeerMetadata, HubMetadata>
{
  /**
   * The ZeroHub client instance.
   * This is initialized in the init method and used to manage peer connections.
   */
  zeroHub: ZeroHubClient<PeerMetadata, HubMetadata> | undefined;

  /**
   * The ID of the peer acting as the SFU.
   * If not set, the first peer in the hub becomes the SFU.
   */
  private sfuPeerId: string | undefined;

  /**
   * Creates a new SFU topology instance.
   *
   * @param sfuPeerId - Optional: explicitly set which peer should act as the SFU.
   *                    If not provided, the first peer to join becomes the SFU.
   */
  constructor(sfuPeerId?: string) {
    this.sfuPeerId = sfuPeerId;
  }

  init(zeroHub: ZeroHubClient<PeerMetadata, HubMetadata>) {
    this.zeroHub = zeroHub;
  }

  /**
   * Determines if the current peer is the SFU.
   *
   * @returns True if this peer is the SFU, false otherwise.
   */
  private isSFU(): boolean {
    if (!this.zeroHub || !this.zeroHub.myPeerId) {
      return false;
    }

    // If SFU peer ID is explicitly set, check against it
    if (this.sfuPeerId) {
      return this.zeroHub.myPeerId === this.sfuPeerId;
    }

    // Otherwise, the peer with the lowest ID becomes the SFU
    const allPeerIds = Object.keys(this.zeroHub.peers);
    if (allPeerIds.length === 0) {
      return true; // First peer is always the SFU
    }

    const lowestPeerId = [this.zeroHub.myPeerId, ...allPeerIds].sort().shift();
    return this.zeroHub.myPeerId === lowestPeerId;
  }

  /**
   * Gets the SFU peer ID.
   *
   * @returns The ID of the SFU peer, or undefined if not determined yet.
   */
  private getSFUPeerId(): string | undefined {
    if (!this.zeroHub || !this.zeroHub.myPeerId) {
      return undefined;
    }

    // If explicitly set, return it
    if (this.sfuPeerId) {
      return this.sfuPeerId;
    }

    // Otherwise, determine the lowest peer ID
    const allPeerIds = Object.keys(this.zeroHub.peers);
    if (allPeerIds.length === 0) {
      return this.zeroHub.myPeerId;
    }

    return [this.zeroHub.myPeerId, ...allPeerIds].sort().shift();
  }

  onPeerStatusChange(peer: Peer<PeerMetadata>) {
    if (!this.zeroHub || !this.zeroHub.myPeerId) {
      throw new Error("ZeroHub is not initialized");
    }

    const iAmSFU = this.isSFU();
    const sfuPeerId = this.getSFUPeerId();
    const peerIsSFU = peer.id === sfuPeerId;

    switch (peer.status) {
      case PeerStatus.Connected:
        if (iAmSFU) {
          this.zeroHub.logger.log(`SFU: Peer ${peer.id} connected`);
        }
        break;

      case PeerStatus.Pending:
        // Determine connection pattern based on SFU role
        if (iAmSFU) {
          // I am the SFU - I connect to all peers
          this.setupSFUConnection(peer);
        } else if (peerIsSFU) {
          // The peer is the SFU - connect to it
          this.setupClientToSFUConnection(peer);
        } else {
          // Neither is SFU - no direct connection needed in SFU topology
          // Regular clients don't connect to each other, only to the SFU
          this.zeroHub.logger.log(
            `Skipping connection between non-SFU peers: ${this.zeroHub.myPeerId} and ${peer.id}`
          );
          return;
        }
        break;

      case PeerStatus.ZeroHubDisconnected:
        if (peerIsSFU) {
          this.zeroHub.logger.warn("SFU peer disconnected - topology may fail");
          // In a production scenario, you might want to elect a new SFU here
        }
        break;
    }
  }

  /**
   * Sets up a connection where this peer (the SFU) connects to a client peer.
   * The SFU receives media from the client and can forward it to other clients.
   *
   * @param peer - The client peer to connect to.
   */
  private setupSFUConnection(peer: Peer<PeerMetadata>) {
    if (!this.zeroHub) {
      return;
    }

    this.zeroHub.logger.log(`SFU: Setting up connection to client ${peer.id}`);

    // SFU creates the offer (acts as offerer)
    const isOfferer = true;

    // Set up data channel if configured
    if (this.zeroHub.config.dataChannelConfig?.onDataChannel) {
      if (isOfferer) {
        const dataChannel = peer.rtcConn.createDataChannel(
          "data",
          this.zeroHub.config.dataChannelConfig.rtcDataChannelInit
        );
        this.zeroHub.config.dataChannelConfig.onDataChannel(
          peer,
          dataChannel,
          true
        );
      } else {
        peer.rtcConn.ondatachannel = (event) => {
          if (event.channel) {
            this.zeroHub?.config.dataChannelConfig?.onDataChannel(
              peer,
              event.channel,
              false
            );
          }
        };
      }
    }

    // Set up media channels if configured
    if (this.zeroHub.config.mediaChannelConfig) {
      // SFU can optionally send its own stream
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

      // Receive streams from the client
      peer.rtcConn.ontrack = (event) => {
        this.zeroHub?.logger.log(`SFU: Received track from client ${peer.id}`);
        this.zeroHub?.config.mediaChannelConfig?.onTrack?.(peer, event);

        // In a full SFU implementation, you would forward this track to other peers here
        // For now, we just notify via the callback
      };
    }

    // Send the offer
    if (isOfferer) {
      this.zeroHub
        .sendOffer(peer.id, this.zeroHub.config.rtcOfferOptions)
        .catch((err) => {
          this.zeroHub?.logger.error(
            "SFU: Failed to send offer to client",
            peer.id,
            err
          );
        });
    }
  }

  /**
   * Sets up a connection where this peer (a client) connects to the SFU.
   * The client sends its media to the SFU and receives forwarded media from the SFU.
   *
   * @param peer - The SFU peer to connect to.
   */
  private setupClientToSFUConnection(peer: Peer<PeerMetadata>) {
    if (!this.zeroHub) {
      return;
    }

    this.zeroHub.logger.log("Client: Connecting to SFU");

    // Client is the answerer (SFU creates the offer)

    // Set up data channel if configured
    if (this.zeroHub.config.dataChannelConfig?.onDataChannel) {
      // Wait for the data channel from the SFU
      peer.rtcConn.ondatachannel = (event) => {
        if (event.channel) {
          this.zeroHub?.logger.log("Client: Received data channel from SFU");
          this.zeroHub?.config.dataChannelConfig?.onDataChannel(
            peer,
            event.channel,
            false
          );
        }
      };
    }

    // Set up media channels if configured
    if (this.zeroHub.config.mediaChannelConfig) {
      // Send local stream to the SFU
      if (this.zeroHub.config.mediaChannelConfig.localStream) {
        this.zeroHub.config.mediaChannelConfig.localStream
          .getTracks()
          .forEach((track) => {
            if (this.zeroHub?.config.mediaChannelConfig?.localStream) {
              this.zeroHub.logger.log("Client: Sending track to SFU");
              peer.rtcConn.addTrack(
                track,
                this.zeroHub.config.mediaChannelConfig.localStream
              );
            }
          });
      }

      // Receive forwarded streams from the SFU
      peer.rtcConn.ontrack = (event) => {
        this.zeroHub?.logger.log("Client: Received track from SFU");
        this.zeroHub?.config.mediaChannelConfig?.onTrack?.(peer, event);
      };
    }

    // Client waits for offer from SFU (doesn't initiate)
    // The offer will come through the signaling and trigger autoAnswer
  }
}

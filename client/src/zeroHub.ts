import {
  DEFAULT_CONFIG,
  DEFAULT_RTC_CONFIG,
  DEFAULT_RTC_OFFER_OPTIONS,
} from "./const";
import { ZeroHubLogger } from "./logger";
import { Peer } from "./peer";
import { ClientMessage } from "./proto/client_message";
import { ServerMessage } from "./proto/server_message";
import { MeshTopology, Topology } from "./topology";
import { PeerStatus, type Config, type HubInfo } from "./types";
import { getWS } from "./utils";

/**
 * Represents a ZeroHub client that manages connections to a ZeroHub server and handles peer-to-peer WebRTC connections.
 * @typeParam PeerMetadata - The type of metadata associated with the peer.
 * @typeParam HubMetadata - The type of metadata associated with the hub.
 */
export class ZeroHubClient<PeerMetadata = object, HubMetadata = object> {
  /**
   * The configuration for the ZeroHub client.
   * @public
   */
  public config: Config<PeerMetadata>;
  /**
   * The metadata for the hub.
   * @public
   */
  public hubMetadata: HubMetadata | undefined;
  /**
   * The metadata for the peer.
   * @public
   */
  public peerMetadata: PeerMetadata | undefined;
  /**
   * The ID of the current peer.
   * @public
   */
  public myPeerId?: string;
  /**
   * Information about the hub.
   * @public
   */
  public hubInfo?: HubInfo<HubMetadata>;
  /**
   * A map of peers connected to the hub.
   * @public
   */
  public peers: { [id: string]: Peer<PeerMetadata> };
  /**
   * The topology used for connecting to other peers.
   * @public
   */
  public topology: Topology<PeerMetadata, HubMetadata>;
  /**
   * The hosts of the ZeroHub server.
   * @public
   */
  public hosts: string[];
  /**
   * The index of the current host.
   * @public
   */
  public hostIndex: number;
  /**
   * The current host.
   * @public
   */
  public host: string;
  /**
   * The WebSocket connection to the ZeroHub server.
   * @public
   */
  public ws?: WebSocket;
  /**
   * A callback function that is called when a ZeroHub error occurs.
   * @public
   */
  public onZeroHubError?: (error: Error) => void;
  /**
   * A callback function that is called when the hub information changes.
   * @public
   */
  public onHubInfo?: (hubInfo: HubInfo<HubMetadata>) => void;
  /**
   * A callback function that is called when a peer's status changes.
   * @public
   */
  public onPeerStatusChange?: (peer: Peer<PeerMetadata>) => void;
  /**
   * A callback function that is called when a peer error occurs.
   * @public
   */
  public onPeerError?: (peer: Peer<PeerMetadata>, error: Error) => void;
  /**
   * The logger used for logging messages.
   * @public
   */
  public logger: ZeroHubLogger;

  /**
   * Creates a new ZeroHub Client class
   *
   * @param hosts - ZeroHub hosts without protocol. if the first host is not working, it will try to connect to the next host. for example `['sg1.zerohub.dev', 'sg2.zerohub.dev']`
   * @param config - ZeroHub client configuration
   * @param topology - WebRTC topology for this client, default is mesh topology
   */
  constructor(
    hosts: string[],
    config: Partial<Config<PeerMetadata>> = {},
    topology: Topology<PeerMetadata, HubMetadata> = new MeshTopology<
      PeerMetadata,
      HubMetadata
    >()
  ) {
    if (!hosts || hosts.length < 1) {
      throw new Error("The hosts must be at least one");
    }

    // Set default config
    this.config = Object.assign(DEFAULT_CONFIG, config);
    this.config.rtcConfig = Object.assign(DEFAULT_RTC_CONFIG, config.rtcConfig);
    this.config.rtcOfferOptions = Object.assign(
      DEFAULT_RTC_OFFER_OPTIONS,
      config.rtcOfferOptions
    );

    this.logger = new ZeroHubLogger(this.config.logger, this.config.logLevel);

    this.peers = {};
    this.hosts = hosts;
    this.hostIndex = 0;
    this.host = hosts[this.hostIndex];
    this.topology = topology;

    if (this.topology) {
      this.logger.log(`using ${this.topology.constructor.name} topology`);
      this.topology.init(this);
    }
  }

  /**
   * Gets the next ZeroHub backup host.
   *
   * If the current host is the last one in the list, it will reject with an error.
   * If there are more hosts available, it increments the host index and resolves with the next host.
   *
   * @returns A promise that resolves with the next ZeroHub host or rejects with an error if no more hosts are available.
   * @throws If all ZeroHub hosts are not working.
   */
  getZeroHubBackupHost(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.hostIndex >= this.hosts.length - 1) {
        reject(
          new Error(
            "all ZeroHub hosts are not working, please check the ZeroHub hosts"
          )
        );
        return;
      }
      this.hostIndex = this.hostIndex + 1;
      resolve(this.hosts[this.hostIndex]);
    });
  }

  /**
   * Updates the status of a peer.
   *
   * @param peerId - The ID of the peer to update status for.
   * @param status - The new status to set for the peer.
   */
  updatePeerStatus(peerId: string, status: PeerStatus) {
    const peer = this.peers[peerId];
    if (!peer) {
      this.logger.error(
        `update status error: peer id ${peerId} not found, status ${status}`
      );
      return;
    }

    peer.status = status;
    if (this.topology?.onPeerStatusChange) {
      this.topology.onPeerStatusChange(peer);
    }
    if (this.onPeerStatusChange) {
      this.onPeerStatusChange(peer);
    }
  }

  /**
   * Reconnects to ZeroHub with the current URL and an optional new host.
   * If a new host is provided, it updates the current URL's host and reconnects.
   * If no new host is provided, it fetches a backup host and reconnects to it.
   *
   * @param currentURL - The current URL of the ZeroHub connection.
   * @param newHost - An optional new host to connect to.
   */
  public reconnect(currentURL: URL, newHost?: string) {
    if (newHost) {
      this.logger.warn(
        `ZeroHub \`${this.host}\` is redirecting to \`${newHost}\`, reconnecting...`
      );
      currentURL.host = newHost;
      this.connectToZeroHub(currentURL);
      return;
    }
    this.getZeroHubBackupHost()
      .then((newHost) => {
        if (this.host === newHost) {
          this.logger.error("zero hub reconnecting failed: not retying");
          return;
        }

        // reconnect to the new host
        this.logger.warn(
          `ZeroHub \`${this.host}\` is reconnecting the new host: \`${newHost}\``
        );

        this.host = newHost;
        currentURL.host = newHost;
        this.connectToZeroHub(currentURL);
      })
      .catch((err) => {
        this.logger.error(`zero hub reconnecting failed: ${err}`);
      });
  }

  /**
   * Handles a message received from the ZeroHub server.
   *
   * @param serverMessage - The message received from the server.
   */
  handleZeroHubMessage(serverMessage: ServerMessage) {
    if (serverMessage.hubInfoMessage) {
      const hubInfoMsg = serverMessage.hubInfoMessage;

      this.myPeerId = hubInfoMsg.myPeerId;
      this.hubInfo = {
        id: hubInfoMsg.id,
        metadata: (hubInfoMsg.hubMetadata
          ? JSON.parse(hubInfoMsg.hubMetadata)
          : {}) as HubMetadata,
        createdAt: new Date(hubInfoMsg.createdAt),
      };
      if (this.onHubInfo) {
        this.onHubInfo(this.hubInfo);
      }

      // new peer if not exists
      for (const peer of hubInfoMsg.peers) {
        if (peer.id !== this.myPeerId && !(peer.id in this.peers)) {
          const newPeer = new Peer<PeerMetadata>(
            peer.id,
            PeerStatus.Pending,
            (peer.metadata ? JSON.parse(peer.metadata) : {}) as PeerMetadata,
            new Date(peer.joinedAt),
            new RTCPeerConnection(this.config.rtcConfig)
          );
          newPeer.rtcConn.onconnectionstatechange = (ev) => {
            this.logger.log("onconnectionstatechange", ev);
            if (newPeer.rtcConn.connectionState === "connected") {
              this.updatePeerStatus(peer.id, PeerStatus.Connected);
            } else if (newPeer.rtcConn.connectionState === "disconnected") {
              this.updatePeerStatus(peer.id, PeerStatus.WebRTCDisconnected);
            }
          };
          newPeer.rtcConn.oniceconnectionstatechange = (ev) => {
            // https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation#explicit_restartice_method_added
            this.logger.log("onconnectionstatechange", ev);
            if (newPeer.rtcConn.iceConnectionState === "failed") {
              newPeer.rtcConn.restartIce();
            }
          };

          this.peers[peer.id] = newPeer;

          this.updatePeerStatus(peer.id, PeerStatus.Pending);
        }
      }
    } else if (serverMessage.offerMessage) {
      const offerPeerId = serverMessage.offerMessage.offerPeerId;
      const offerSdp = serverMessage.offerMessage.offerSdp;

      this.updatePeerStatus(offerPeerId, PeerStatus.AnswerPending);

      if (this.config.autoAnswer) {
        this.sendAnswer(offerPeerId, offerSdp).catch((err) => {
          this.logger.error("Failed to send answer to peer", offerPeerId, err);
        });
      }
    } else if (serverMessage.answerMessage) {
      const answerPeerId = serverMessage.answerMessage.answerPeerId;
      const answerSdp = serverMessage.answerMessage.answerSdp;

      this.updatePeerStatus(answerPeerId, PeerStatus.AcceptPending);

      if (this.config.autoAcceptAnswer) {
        this.acceptAnswer(answerPeerId, answerSdp).catch((err) => {
          this.logger.error(
            "Failed to accept answer to peer",
            answerPeerId,
            err
          );
        });
      }
    } else if (serverMessage.peerJoinedMessage) {
      const peer = serverMessage.peerJoinedMessage.peer;
      if (!peer || !this.hubInfo) {
        return;
      }

      const newPeer = new Peer<PeerMetadata>(
        peer.id,
        PeerStatus.Pending,
        (peer.metadata ? JSON.parse(peer.metadata) : {}) as PeerMetadata,
        new Date(peer.joinedAt),
        new RTCPeerConnection(this.config.rtcConfig)
      );
      newPeer.rtcConn.onconnectionstatechange = (ev) => {
        this.logger.log("onconnectionstatechange", ev);
        if (newPeer.rtcConn.connectionState === "connected") {
          this.updatePeerStatus(peer.id, PeerStatus.Connected);
        } else if (newPeer.rtcConn.connectionState === "disconnected") {
          this.updatePeerStatus(peer.id, PeerStatus.WebRTCDisconnected);
        }
      };

      this.peers[peer.id] = newPeer;

      this.updatePeerStatus(peer.id, PeerStatus.Pending);
    } else if (serverMessage.peerDisconnectedMessage) {
      const peerId = serverMessage.peerDisconnectedMessage.peerId;

      this.updatePeerStatus(peerId, PeerStatus.ZeroHubDisconnected);
    }
  }

  /**
   * Connects to the ZeroHub using the provided URL and sets up WebSocket event handlers for receiving messages, errors, and close events.
   *
   * @param url - The URL of the ZeroHub to connect to
   */
  public connectToZeroHub(url: URL) {
    this.logger.log("connecting to ZeroHub:", url);

    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";
    this.ws.onmessage = (event: MessageEvent<Iterable<number>>) => {
      const serverMessage = ServerMessage.decode(new Uint8Array(event.data));
      this.logger.log("received zerohub message", serverMessage);
      this.handleZeroHubMessage(serverMessage);
    };
    // TODO: wait for error, close, or open to response promise result
    this.ws.onerror = (event) => {
      this.logger.error(`ZeroHub WebSocket error: ${JSON.stringify(event)}`);
      if (this.onZeroHubError) {
        this.onZeroHubError(
          Error(`ZeroHub WebSocket error: ${JSON.stringify(event)}`)
        );
      }
      this.reconnect(url);
    };
    this.ws.onclose = (event) => {
      // See https://www.rfc-editor.org/rfc/rfc6455#section-7.4.1
      switch (event.code) {
        case 1000:
          return;
        case 1001:
          // 1001 is going away
          this.logger.warn(
            `ZeroHub WebSocket closed: ${event.reason}, code: ${event.code}`,
            event
          );
          if (typeof event.reason === "string") {
            this.reconnect(url, event.reason);
          }
          return;
        case 1006:
        case 1011:
          // 1006 is abnormal closure
          // 1011 is internal error
          this.reconnect(url);
          return;
        default:
          if (this.onZeroHubError) {
            this.onZeroHubError(
              Error(
                `ZeroHub error code \`${event.code}\` reason \`${event.reason}\``
              )
            );
          }
          break;
      }
    };
    this.ws.onopen = () => {};
  }

  /**
   * Sends a message to ZeroHub.
   *
   * @param msg - the message to be sent to ZeroHub
   */
  public sendZeroHubMessage(msg: ClientMessage) {
    if (!this.ws) {
      throw Error(
        "ZeroHub not connected, please connect to ZeroHub by `createHub` or `joinHub`"
      );
    }

    const encoded = ClientMessage.encode(msg).finish();
    this.ws.send(encoded);
  }

  /**
   * Sends an offer to a WebSocket with the given peer ID and offer session.
   *
   * @param peerId - The ID of the peer
   * @param offerSession - The offer session description
   */
  public sendOfferToWebsocket(
    peerId: string,
    offerSession: RTCSessionDescription
  ) {
    this.sendZeroHubMessage({
      sendOfferMessage: {
        answerPeerId: peerId,
        offerSdp: offerSession.sdp,
      },
    });

    this.updatePeerStatus(peerId, PeerStatus.Offering);
  }

  /**
   * Send answer SDP to the peer
   *
   * @param peerId - The peer to send the answer to
   * @param answerSession - RTCSessionDescription generated by answerer
   */
  public sendAnswerToWebsocket(
    peerId: string,
    answerSession: RTCSessionDescription
  ) {
    this.sendZeroHubMessage({
      sendAnswerMessage: {
        offerPeerId: peerId,
        answerSdp: answerSession.sdp,
      },
    });

    this.updatePeerStatus(peerId, PeerStatus.Answering);
  }

  /**
   * Send an offer to the specified peer using WebRTC.
   *
   * @param peerId - The ID of the peer to send the offer to
   * @param rtcOfferOptions - The options for the WebRTC offer (default: \{ offerToReceiveAudio: false, offerToReceiveVideo: false \})
   * @param rtcConfig - The configuration for the WebRTC connection
   */
  public async sendOffer(
    peerId: string,
    rtcOfferOptions: RTCOfferOptions = {},
    rtcConfig?: RTCConfiguration
  ) {
    if (!this.ws) {
      throw Error(
        "send offer error: ZeroHub not connected, please connect to ZeroHub by `createHub` or `joinHub`"
      );
    }

    rtcOfferOptions = Object.assign(
      this.config.rtcOfferOptions,
      rtcOfferOptions
    );
    const peer = this.peers[peerId];
    if (!peer) {
      this.logger.error(`send offer error: peer id ${peerId} not found`);
      return;
    }

    // replace RTC config
    if (rtcConfig) {
      peer.rtcConn.setConfiguration(rtcConfig);
    }

    let isSent = false;

    peer.rtcConn.onicecandidate = (event) => {
      if (!peer.rtcConn.localDescription || isSent || event.candidate) {
        return;
      }

      isSent = true;
      this.sendOfferToWebsocket(peerId, peer.rtcConn.localDescription);
    };

    const offer = await peer.rtcConn.createOffer(rtcOfferOptions);
    await peer.rtcConn.setLocalDescription(offer);

    // stop waiting for ice candidates if longer than timeout
    setTimeout(() => {
      this.logger.warn("timeout waiting ICE candidates");
      if (!peer.rtcConn.localDescription || isSent) {
        return;
      }

      isSent = true;
      this.sendOfferToWebsocket(peerId, peer.rtcConn.localDescription);
    }, this.config.waitIceCandidatesTimeout);
  }

  /**
   * Send the answer to a peer.
   *
   * @param peerId - The ID of the peer
   * @param offerSdp - The offer SDP
   * @param rtcOfferOptions - Options for the RTC offer (default: \{ offerToReceiveAudio: false, offerToReceiveVideo: false \})
   * @param rtcConfig - Optional RTC configuration
   */
  public async sendAnswer(
    peerId: string,
    offerSdp: string,
    rtcOfferOptions: RTCOfferOptions = {},
    rtcConfig?: RTCConfiguration
  ) {
    if (!this.ws) {
      throw Error(
        "send answer error: ZeroHub not connected, please connect to ZeroHub by `createHub` or `joinHub`"
      );
    }

    rtcOfferOptions = Object.assign(
      this.config.rtcOfferOptions,
      rtcOfferOptions
    );

    const peer = this.peers[peerId];
    if (!peer) {
      this.logger.error(`send answer error: peer id ${peerId} not found`);
      return;
    }

    // replace RTC config
    if (rtcConfig) {
      peer.rtcConn.setConfiguration(rtcConfig);
    }

    await peer.rtcConn.setRemoteDescription({
      type: "offer",
      sdp: offerSdp,
    });

    let isSent = false;
    peer.rtcConn.onicecandidate = (event) => {
      this.logger.log("onicecandidate", event);
      if (!peer.rtcConn.localDescription || isSent || event.candidate) {
        return;
      }

      isSent = true;
      this.sendAnswerToWebsocket(peerId, peer.rtcConn.localDescription);
    };

    const offer = await peer.rtcConn.createAnswer(rtcOfferOptions);
    await peer.rtcConn.setLocalDescription(offer);

    // stop waiting for ice candidates if longer than timeout
    setTimeout(() => {
      this.logger.warn("timeout waiting ICE candidates");
      if (!peer.rtcConn.localDescription || isSent) {
        return;
      }

      isSent = true;
      this.sendAnswerToWebsocket(peerId, peer.rtcConn.localDescription);
    }, this.config.waitIceCandidatesTimeout);
  }

  /**
   * Accepts an answer from a peer by setting the remote description.
   *
   * @param peerId - The ID of the peer sending the answer
   * @param answerSdp - The answer Session Description Protocol (SDP)
   */
  public async acceptAnswer(peerId: string, answerSdp: string) {
    const peer = this.peers[peerId];
    if (!peer) {
      this.logger.error(`accept answer error: peer id ${peerId} not found`);
      return;
    }

    await peer.rtcConn.setRemoteDescription({
      type: "answer",
      sdp: answerSdp,
    });
  }

  /**
   *  Creates a new hub on ZeroHub
   *
   *
   * @param hubId - The id of the hub to create
   * @param peerMetadata - Peer metadata will share to each peer in the Hub
   * @param hubMetadata - Hub metadata will share to each peer in the Hub
   */
  public createHub(
    hubId: string,
    peerMetadata?: PeerMetadata,
    hubMetadata?: HubMetadata
  ) {
    const url = new URL("/v1/hubs/create", getWS(this.host, this.config.tls));
    url.searchParams.set("id", hubId);

    if (hubMetadata) {
      this.hubMetadata = hubMetadata;
      url.searchParams.set("hubMetadata", JSON.stringify(hubMetadata));
    }
    if (peerMetadata) {
      this.peerMetadata = peerMetadata;
      url.searchParams.set("peerMetadata", JSON.stringify(peerMetadata));
    }

    this.connectToZeroHub(url);
  }

  /**
   * Join an existing hub on ZeroHub
   *
   * @param hubId - The id of the hub to join
   * @param peerMetadata - Peer metadata will share to each peer in the Hub
   */
  public joinHub(hubId: string, peerMetadata?: PeerMetadata) {
    this.peerMetadata = peerMetadata;

    const url = new URL("/v1/hubs/join", getWS(this.host, this.config.tls));
    url.searchParams.set("id", hubId);

    if (peerMetadata) {
      this.peerMetadata = peerMetadata;
      url.searchParams.set("peerMetadata", JSON.stringify(peerMetadata));
    }

    this.connectToZeroHub(url);
  }

  /**
   * Join an existing hub or create if not on ZeroHub
   *
   * @param hubId - The id of the hub to join or create
   * @param peerMetadata - Peer metadata will share to each peer in the Hub
   * @param hubMetadata - (will only use if no hub exist) Hub metadata will share to each peer in the Hub
   *
   */
  public joinOrCreateHub(
    hubId: string,
    peerMetadata?: PeerMetadata,
    hubMetadata?: HubMetadata
  ) {
    this.peerMetadata = peerMetadata;

    const url = new URL(
      "/v1/hubs/join-or-create",
      getWS(this.host, this.config.tls)
    );
    url.searchParams.set("id", hubId);

    if (hubMetadata) {
      this.hubMetadata = hubMetadata;
      url.searchParams.set("hubMetadata", JSON.stringify(hubMetadata));
    }
    if (peerMetadata) {
      this.peerMetadata = peerMetadata;
      url.searchParams.set("peerMetadata", JSON.stringify(peerMetadata));
    }

    this.connectToZeroHub(url);
  }

  /**
   * Join an existing hub or create if the IP hub on ZeroHub
   * The IP Hub is a hub that will use the IP address as the hub id
   *
   * @param peerMetadata - Peer metadata will share to each peer in the Hub
   * @param hubMetadata - (will only use if no hub exist) Hub metadata will share to each peer in the Hub
   *
   */
  public joinOrCreateIPHub(
    peerMetadata?: PeerMetadata,
    hubMetadata?: HubMetadata
  ) {
    this.peerMetadata = peerMetadata;

    const url = new URL(
      "/v1/ip-hubs/join-or-create",
      getWS(this.host, this.config.tls)
    );

    if (hubMetadata) {
      this.hubMetadata = hubMetadata;
      url.searchParams.set("hubMetadata", JSON.stringify(hubMetadata));
    }
    if (peerMetadata) {
      this.peerMetadata = peerMetadata;
      url.searchParams.set("peerMetadata", JSON.stringify(peerMetadata));
    }

    this.connectToZeroHub(url);
  }

  /**
   * Join an existing IP Hub on ZeroHub
   *
   * @param hubId - The id of the IP Hub to join
   * @param peerMetadata - Peer metadata will share to each peer in the Hub
   */
  public joinIPHub(hubId: string, peerMetadata?: PeerMetadata) {
    this.peerMetadata = peerMetadata;

    const url = new URL("/v1/ip-hubs/join", getWS(this.host, this.config.tls));
    url.searchParams.set("id", hubId);

    if (peerMetadata) {
      this.peerMetadata = peerMetadata;
      url.searchParams.set("peerMetadata", JSON.stringify(peerMetadata));
    }

    this.connectToZeroHub(url);
  }

  /**
   * Creates a new Random Hub on ZeroHub
   * The Random Hub is a hub that will use a random id as the hub id
   *
   * @param peerMetadata - Peer metadata will share to each peer in the Hub
   * @param hubMetadata - Hub metadata will share to each peer in the Hub
   */
  public createRandomHub(
    peerMetadata?: PeerMetadata,
    hubMetadata?: HubMetadata
  ) {
    const url = new URL(
      "/v1/random-hubs/create",
      getWS(this.host, this.config.tls)
    );

    if (hubMetadata) {
      this.hubMetadata = hubMetadata;
      url.searchParams.set("hubMetadata", JSON.stringify(hubMetadata));
    }
    if (peerMetadata) {
      this.peerMetadata = peerMetadata;
      url.searchParams.set("peerMetadata", JSON.stringify(peerMetadata));
    }

    this.connectToZeroHub(url);
  }

  /**
   * Join an existing Random Hub on ZeroHub
   *
   * @param hubId - The id of the hub to join
   * @param peerMetadata - Peer metadata will share to each peer in the Hub
   */
  public joinRandomHub(hubId: string, peerMetadata?: PeerMetadata) {
    this.peerMetadata = peerMetadata;

    const url = new URL(
      "/v1/random-hubs/join",
      getWS(this.host, this.config.tls)
    );
    url.searchParams.set("id", hubId);

    if (peerMetadata) {
      this.peerMetadata = peerMetadata;
      url.searchParams.set("peerMetadata", JSON.stringify(peerMetadata));
    }

    this.connectToZeroHub(url);
  }
}

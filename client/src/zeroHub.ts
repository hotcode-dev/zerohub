import {
  defaultConfig,
  defaultRtcConfig,
  defaultRtcOfferOptions,
} from "./const";
import { Peer } from "./peer";
import { ClientMessage } from "./proto/client_message";
import { ServerMessage } from "./proto/server_message";
import { LogLevel, PeerStatus, type Config, type HubInfo } from "./types";
import { fetchWithTimeout, getHTTP, getWS } from "./utils";

export class ZeroHubClient<PeerMetadata = object, HubMetadata = object> {
  // config ZeroHub client configuration
  public config: Config;
  // rtcConfig WebRTC configuration
  public rtcConfig: RTCConfiguration;
  // hubMetadata my hub metadata will send to ZeroHub
  public hubMetadata: HubMetadata | undefined;
  // peerMetadata my peer metadata will send to ZeroHub and another peer
  public peerMetadata: PeerMetadata | undefined;
  // myPeerId my peer id
  public myPeerId?: number;
  // hubInfo hub info of ZeroHub
  public hubInfo?: HubInfo<HubMetadata>;
  // peers a map of peer
  public peers: { [id: number]: Peer<PeerMetadata> };

  // the hosts of ZeroHub without protocal. if the first host is not working, it will try to connect to the next host
  public hosts: string[];
  // the current ZeroHub host index
  public hostIndex: number;
  // the current ZeroHub host without protocal
  public host: string;
  // ws websocket connection to ZeroHub
  public ws?: WebSocket;

  // onZeroHubError will be called when ZeroHub error
  public onZeroHubError?: (error: Error) => void;
  // onHubInfo will be called when hub info changes
  public onHubInfo?: (hubInfo: HubInfo<HubMetadata>) => void;
  // onPeerStatusChange will be called when a peer status changes
  public onPeerStatusChange?: (peer: Peer<PeerMetadata>) => void;
  // onPeerError will be called when a peer error
  public onPeerError?: (peer: Peer<PeerMetadata>, error: Error) => void;

  /**
   * Creates a new ZeroHub Client class
   *
   * @param hosts ZeroHub hosts without protocol. if the first host is not working, it will try to connect to the next host. for example `['sg1.zerohub.dev', 'sg2.zerohub.dev']`
   * @param config ZeroHub client configuration
   * @param rtcConfig default WebRTC configuration
   *
   * @returns ZeroHub Client class
   */
  constructor(
    hosts: string[],
    config: Partial<Config> = {},
    rtcConfig: Partial<RTCConfiguration> = {}
  ) {
    if (!hosts || hosts.length < 1) {
      throw new Error("The hosts must be at least one");
    }

    this.config = Object.assign(defaultConfig, config);
    this.rtcConfig = Object.assign(defaultRtcConfig, rtcConfig);
    this.peers = {};
    this.hosts = hosts;
    this.hostIndex = 0;
    this.host = hosts[this.hostIndex];
  }

  log(message?: any, ...optionalParams: any[]) {
    if (this.config.logLevel === LogLevel.Debug) {
      console.log(message, ...optionalParams);
    }
  }
  warn(message?: any, ...optionalParams: any[]) {
    if (
      this.config.logLevel === LogLevel.Debug ||
      this.config.logLevel === LogLevel.Warning
    ) {
      console.warn(message, ...optionalParams);
    }
  }
  error(message?: any, ...optionalParams: any[]) {
    if (
      this.config.logLevel === LogLevel.Debug ||
      this.config.logLevel === LogLevel.Warning ||
      this.config.logLevel === LogLevel.Error
    ) {
      console.error(message, ...optionalParams);
    }
  }

  /**
   * Check the status of ZeroHub and return the backup host if exist.
   * If the ZeroHub status is 301, it will return the backup host.
   *
   * @returns A Promise that resolves to the backup host if exist,
   *          or resolves to undefined if status is 200.
   * @throws Error if the status is not 200 or 301.
   */
  getZeroHubBackupHost(): Promise<string | void> {
    return new Promise((resolve, reject) => {
      const resolveNextHost = () => {
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
      };

      fetchWithTimeout(`${getHTTP(this.host, this.config.tls)}/status`)
        .then((res) => {
          if (res.status === 200) {
            this.log("ZeroHub status is OK");
            resolve();
            return;
          } else if (res.status === 301) {
            // If status is 301, get the new host and resolve with it
            res
              .json()
              .then((data) => {
                const newHost = data.backupHost;
                if (newHost) {
                  resolve(newHost);
                } else {
                  console.error(
                    `status 301, but ZeroHub is not responding with a new host: ${newHost}`
                  );
                  resolveNextHost();
                }
              })
              .catch((err) => {
                console.error(`cannot get new host from status 301: ${err}`);
                resolveNextHost();
              });
            return;
          } else {
            // If status is not 200 or 301, resolve with the next host
            console.error(
              `ZeroHub is not responding with a valid status: ${res.status}`
            );
            resolveNextHost();
          }
        })
        .catch((err) => {
          console.error("ZeroHub status error", err);
          resolveNextHost();
        });
    });
  }

  /**
   * Updates the status of a peer.
   *
   * @param {number} peerId - The ID of the peer to update status for.
   * @param {PeerStatus} status - The new status to set for the peer.
   */
  updatePeerStatus(peerId: number, status: PeerStatus) {
    const peer = this.peers[peerId];
    if (!peer) {
      this.error(
        `update status error: peer id ${peerId} not found, status ${status}`
      );
      return;
    }

    peer.status = status;
    if (this.onPeerStatusChange) this.onPeerStatusChange(peer);
  }

  // reconnect check the current host status then reconnect to the new host
  public reconnect(currentURL: URL) {
    this.getZeroHubBackupHost()
      .then((newHost) => {
        if (newHost) {
          if (this.host === newHost) {
            this.error(`zero hub reconnecting failed: not retying`);
            return;
          }

          // reconnect to the new host
          this.warn(
            `ZeroHub \`${this.host}\` is reconnecting the new host: \`${newHost}\``
          );

          this.host = newHost;
          currentURL.host = newHost;
          this.connectToZeroHub(currentURL);
        }
      })
      .catch((err) => {
        this.error(`zero hub reconnecting failed: ${err}`);
      });
  }

  /**
   * Handles a message received from the ZeroHub server.
   *
   * @param {ServerMessage} serverMessage - The message received from the server.
   */
  handleZeroHubMessage(serverMessage: ServerMessage) {
    if (serverMessage.hubInfoMessage) {
      const hubInfoMsg = serverMessage.hubInfoMessage;

      this.myPeerId = hubInfoMsg.myPeerId;
      this.hubInfo = {
        id: hubInfoMsg.id,
        metadata: hubInfoMsg.hubMetadata
          ? JSON.parse(hubInfoMsg.hubMetadata)
          : {},
        createdAt: new Date(hubInfoMsg.createdAt),
      };
      if (this.onHubInfo) this.onHubInfo(this.hubInfo);

      // new peer if not exists
      for (const peer of hubInfoMsg.peers) {
        if (peer.id !== this.myPeerId && !(peer.id in this.peers)) {
          const newPeer = new Peer<PeerMetadata>(
            peer.id,
            PeerStatus.Pending,
            peer.metadata ? JSON.parse(peer.metadata) : {},
            new Date(peer.joinedAt),
            new RTCPeerConnection(this.rtcConfig)
          );
          newPeer.rtcConn.onconnectionstatechange = (ev) => {
            this.log("onconnectionstatechange", ev);
            if (newPeer.rtcConn.connectionState === "connected") {
              this.updatePeerStatus(peer.id, PeerStatus.Connected);
            } else if (newPeer.rtcConn.connectionState === "disconnected") {
              this.updatePeerStatus(peer.id, PeerStatus.WebRTCDisconnected);
            }
          };
          newPeer.rtcConn.oniceconnectionstatechange = (ev) => {
            // https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation#explicit_restartice_method_added
            this.log("onconnectionstatechange", ev);
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
        this.sendAnswer(offerPeerId, offerSdp);
      }
    } else if (serverMessage.answerMessage) {
      const answerPeerId = serverMessage.answerMessage.answerPeerId;
      const answerSdp = serverMessage.answerMessage.answerSdp;

      this.updatePeerStatus(answerPeerId, PeerStatus.AcceptPending);

      if (this.config.autoAcceptAnswer) {
        this.acceptAnswer(answerPeerId, answerSdp);
      }
    } else if (serverMessage.peerJoinedMessage) {
      const peer = serverMessage.peerJoinedMessage.peer;
      if (!peer || !this.hubInfo) return;

      const newPeer = new Peer<PeerMetadata>(
        peer.id,
        PeerStatus.Pending,
        peer.metadata ? JSON.parse(peer.metadata) : {},
        new Date(peer.joinedAt),
        new RTCPeerConnection(this.rtcConfig)
      );
      newPeer.rtcConn.onconnectionstatechange = (ev) => {
        this.log("onconnectionstatechange", ev);
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
   * @param {URL} url - The URL of the ZeroHub to connect to
   */
  public connectToZeroHub(url: URL) {
    this.log("connecting to ZeroHub:", url);

    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";
    this.ws.onmessage = (event: MessageEvent<Iterable<number>>) => {
      const serverMessage = ServerMessage.decode(new Uint8Array(event.data));
      this.log("received zerohub message", serverMessage);
      this.handleZeroHubMessage(serverMessage);
    };
    // TODO: wait for error, close, or open to response promise result
    this.ws.onerror = (event) => {
      if (this.onZeroHubError) {
        this.onZeroHubError(Error(`ZeroHub error: ${JSON.stringify(event)}`));
      }
      this.reconnect(url);
    };
    this.ws.onclose = (event) => {
      // See https://www.rfc-editor.org/rfc/rfc6455#section-7.4.1
      switch (event.code) {
        case 1000:
          return;
        case 1006:
          // if the code is 1006 mean the connection was closed abnormally
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
    this.ws.onopen = (event) => {};
  }

  /**
   * Sends a message to ZeroHub.
   *
   * @param {ClientMessage} msg - the message to be sent to ZeroHub
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
   * @param {number} peerId - The ID of the peer
   * @param {RTCSessionDescription} offerSession - The offer session description
   */
  public sendOfferToWebsocket(
    peerId: number,
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
   * @param peerId The peer to send the answer to
   * @param answerSession RTCSessionDescription generated by answerer
   */
  public sendAnswerToWebsocket(
    peerId: number,
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
   * @param {number} peerId - The ID of the peer to send the offer to
   * @param {RTCOfferOptions} rtcOfferOptions - The options for the WebRTC offer
   * @param {RTCConfiguration} [rtcConfig] - The configuration for the WebRTC connection
   */
  public async sendOffer(
    peerId: number,
    rtcOfferOptions: RTCOfferOptions = {},
    rtcConfig?: RTCConfiguration
  ) {
    if (!this.ws) {
      throw Error(
        "send offer error: ZeroHub not connected, please connect to ZeroHub by `createHub` or `joinHub`"
      );
    }
    rtcOfferOptions = Object.assign(defaultRtcOfferOptions, rtcOfferOptions);
    const peer = this.peers[peerId];
    if (!peer) {
      this.error(`send offer error: peer id ${peerId} not found`);
      return;
    }

    // replace RTC config
    if (rtcConfig) {
      peer.rtcConn.setConfiguration(rtcConfig);
    }

    let isSent = false;

    peer.rtcConn.onicecandidate = (event) => {
      if (!peer.rtcConn.localDescription || isSent || event.candidate) return;

      isSent = true;
      this.sendOfferToWebsocket(peerId, peer.rtcConn.localDescription);
    };

    const offer = await peer.rtcConn.createOffer(rtcOfferOptions);
    await peer.rtcConn.setLocalDescription(offer);

    // stop waiting for ice candidates if longer than timeout
    setTimeout(() => {
      this.warn("timeout waiting ICE candidates");
      if (!peer.rtcConn.localDescription || isSent) return;

      isSent = true;
      this.sendOfferToWebsocket(peerId, peer.rtcConn.localDescription);
    }, this.config.waitIceCandidatesTimeout);
  }

  /**
   * Send the answer to a peer.
   *
   * @param {number} peerId - The ID of the peer
   * @param {string} offerSdp - The offer SDP
   * @param {RTCOfferOptions} rtcOfferOptions - Options for the RTC offer (default: {})
   * @param {RTCConfiguration} rtcConfig - Optional RTC configuration
   * @return {void}
   */
  public async sendAnswer(
    peerId: number,
    offerSdp: string,
    rtcOfferOptions: RTCOfferOptions = {},
    rtcConfig?: RTCConfiguration
  ) {
    if (!this.ws) {
      throw Error(
        "send answer error: ZeroHub not connected, please connect to ZeroHub by `createHub` or `joinHub`"
      );
    }

    rtcOfferOptions = Object.assign(defaultRtcOfferOptions, rtcOfferOptions);

    const peer = this.peers[peerId];
    if (!peer) {
      console.error(`send answer error: peer id ${peerId} not found`);
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
      this.log("onicecandidate", event);
      if (!peer.rtcConn.localDescription || isSent || event.candidate) return;

      isSent = true;
      this.sendAnswerToWebsocket(peerId, peer.rtcConn.localDescription);
    };

    const offer = await peer.rtcConn.createAnswer(rtcOfferOptions);
    await peer.rtcConn.setLocalDescription(offer);

    // stop waiting for ice candidates if longer than timeout
    setTimeout(() => {
      this.warn("timeout waiting ICE candidates");
      if (!peer.rtcConn.localDescription || isSent) return;

      isSent = true;
      this.sendAnswerToWebsocket(peerId, peer.rtcConn.localDescription);
    }, this.config.waitIceCandidatesTimeout);
  }

  /**
   * Accepts an answer from a peer by setting the remote description.
   *
   * @param {number} peerId - The ID of the peer sending the answer
   * @param {string} answerSdp - The answer Session Description Protocol (SDP)
   */
  public async acceptAnswer(peerId: number, answerSdp: string) {
    const peer = this.peers[peerId];
    if (!peer) {
      console.error(`accept answer error: peer id ${peerId} not found`);
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
   * @param hubId The id of the hub to create
   * @param peerMetadata Peer metadata will share to each peer in the Hub
   * @param hubMetaData Hub metadata will share to each peer in the Hub
   */
  public createHub(
    hubId: string,
    peerMetadata?: PeerMetadata,
    hubMetadata?: HubMetadata
  ) {
    const url = new URL("/hubs/create", getWS(this.host, this.config.tls));
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
   * Joins an existing hub or create if not on ZeroHub
   *
   * @param hubId The id of the hub to join or create
   * @param peerMetadata Peer metadata will share to each peer in the Hub
   * @param hubMetaData (will only use if no hub exist) Hub metadata will share to each peer in the Hub
   *
   */
  public joinHub(
    hubId: string,
    peerMetadata?: PeerMetadata,
    hubMetadata?: HubMetadata
  ) {
    this.peerMetadata = peerMetadata;

    const url = new URL("/hubs/join", getWS(this.host, this.config.tls));
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
}

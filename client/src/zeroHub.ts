import {
  DEFAULT_CONFIG,
  DEFAULT_RTC_CONFIG,
  DEFAULT_RTC_OFFER_OPTIONS,
} from "./const";
import { ZeroHubLogger } from "./logger";
import { Peer } from "./peer";
import { ClientMessage } from "./proto/zerohub/v1/client_message";
import { ServerMessage } from "./proto/zerohub/v1/server_message";
import { MeshTopology, Topology } from "./topology";
import { PeerStatus, type Config, type HubInfo } from "./types";
import { getWS, isWellFormedHost } from "./utils";

/**
 * ZeroHubClient manages the full lifecycle of connecting to a ZeroHub
 * signaling server and establishing peer-to-peer WebRTC connections.
 *
 * ## Connection Lifecycle
 *
 * 1. **Constructor** — `new ZeroHubClient(hosts, config, topology)` initializes the client with server addresses, configuration (including TLS, logging, and WebRTC settings), and a topology strategy (default: MeshTopology). No network connection is made yet.
 *
 * 2. **Connect** — Call `client.connect()` (or the convenience methods `createHub()`, `joinHub()`, `joinOrCreate()`) to establish a WebSocket connection. The client automatically handles reconnection with failover across multiple hosts.
 *
 * 3. **Hub Establishment** — The server responds with a `HubInfoMessage` containing the hub's metadata, the client's own peer ID, and the list of existing peers. New peers are created in the `peers` map with `PeerStatus.Pending`.
 *
 * 4. **Peer Negotiation** — When a new peer joins or during initial setup, the client initiates WebRTC offer/answer exchange over the WebSocket link. The client sends SDP (Session Description Protocol) offers to peers, receives answers, and manages ICE candidate exchange. Status progresses: `Pending → Offering/Answering → Connected`.
 *
 * 5. **Connected Mesh** — Once connected, peers establish direct WebRTC data channels (or media streams) for peer-to-peer communication. The server is no longer in the data path — it only handled signaling.
 *
 * 6. **Message Handling** — All server messages are protobuf-encoded WebSocket frames decoded via `ServerMessage.decode()`. The client dispatches them to `handleZeroHubMessage()` which routes to appropriate handlers (offer, answer, ICE candidates, peer join/disconnect).
 *
 * 7. **Reconnection** — On WebSocket errors or closures, the client retries with backup hosts. Connection states persist across reconnection attempts.
 *
 * 8. **Disconnect** — Call `client.disconnect()` to close the WebSocket and tear down all peer connections. Peers transition to `PeerStatus.Disconnected`.
 *
 * @typeParam PeerMetadata - The type of metadata associated with the peer. Defaults to `object`.
 * @typeParam HubMetadata - The type of metadata associated with the hub. Defaults to `object`.
 *
 * @example
 * ```typescript
 * import { ZeroHubClient, PeerStatus, LogLevel } from '@zero-hub/client';
 *
 * const client = new ZeroHubClient(['localhost:8080'], {
 *   tls: false,
 *   logLevel: LogLevel.Debug,
 * });
 *
 * client.onHubInfo = (hubInfo) => {
 *   console.log('Connected to hub:', hubInfo.id);
 * };
 *
 * client.onPeerStatusChange = (peer) => {
 *   if (peer.status === PeerStatus.Connected) {
 *     console.log('Peer connected:', peer.id);
 *   }
 * };
 *
 * await client.createHub('my-room', { name: 'Alice' });
 * ```
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
   * Tracks whether the client has been manually disconnected via `disconnect()`.
   * When true, the client will not attempt to auto-reconnect and
   * `sendZeroHubMessage` fails fast. `connectToZeroHub` resets this to
   * `false`, so a new `createHub()`/`joinHub()` after `disconnect()` starts
   * a clean, reusable connection.
   */
  private isDisconnected = false;
  /**
   * Pending ICE candidate timeout handles, keyed by peer ID.
   * These are cleared on disconnect so no offer/answer can be sent to a closed socket.
   */
  private iceTimeouts: { [peerId: string]: ReturnType<typeof setTimeout> } = {};
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
   * A callback function that is called when an offer is received from a
   * remote peer while `autoAnswer` is `false` (manual offer handling). It is
   * invoked with the offering peer and the incoming offer SDP, so the
   * application can complete the exchange by calling
   * `sendAnswer(peer.id, offerSdp)`. Not invoked when `autoAnswer` is `true`
   * (the default), because the client answers automatically.
   *
   * @param peer - The peer that sent the offer
   * @param offerSdp - The offer Session Description Protocol (SDP) to answer
   * @public
   */
  public onOffer?: (peer: Peer<PeerMetadata>, offerSdp: string) => void;
  /**
   * A callback function that is called when an answer is received from a
   * remote peer while `autoAcceptAnswer` is `false` (manual answer
   * handling). It is invoked with the answering peer and the incoming answer
   * SDP, so the application can complete the exchange by calling
   * `acceptAnswer(peer.id, answerSdp)`. Not invoked when `autoAcceptAnswer`
   * is `true` (the default), because the client accepts the answer
   * automatically.
   *
   * @param peer - The peer that sent the answer
   * @param answerSdp - The answer Session Description Protocol (SDP) to accept
   * @public
   */
  public onAnswer?: (peer: Peer<PeerMetadata>, answerSdp: string) => void;
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

    const mergedRtcConfig = {
      ...DEFAULT_RTC_CONFIG,
      ...config.rtcConfig,
    } satisfies RTCConfiguration;
    const mergedRtcOfferOptions = {
      ...DEFAULT_RTC_OFFER_OPTIONS,
      ...config.rtcOfferOptions,
    } satisfies RTCOfferOptions;

    this.config = {
      ...(DEFAULT_CONFIG as Config<PeerMetadata>),
      ...config,
      rtcConfig: mergedRtcConfig,
      rtcOfferOptions: mergedRtcOfferOptions,
    } satisfies Config<PeerMetadata>;

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
    if (this.isDisconnected) {
      this.logger.log("ZeroHub is disconnected, skipping reconnect");
      return;
    }
    if (newHost) {
      // 1001 ("going away") is a generic RFC 6455 code: besides the ZeroHub
      // server's migration redirect, any intermediate hop (reverse proxy,
      // load balancer, edge device) can close with 1001 and a
      // human-readable reason ("Server going away", "Maintenance in
      // progress", ...). Trust such a value as a redirect host and the
      // client would permanently corrupt `this.host` (every entry point
      // builds its URL from it) or throw out of the close handler when
      // assigning `currentURL.host`. Validate the shape first and, on
      // failure, fall through to the automatic host-failover path below
      // without touching host state — mirroring the server's
      // `validateBackupHost` for the host it emits in migration closes.
      if (!isWellFormedHost(newHost)) {
        this.logger.warn(
          `ZeroHub 1001 close reason \`${newHost}\` is not a well-formed host, falling back to host failover`
        );
        this.reconnect(currentURL);
        return;
      }
      // Mirror the backup-host branch below: a redirect back to the host we
      // just disconnected from (operator pointing /admin/migrate at the
      // current host, or a proxy emitting a 1001 with our own host in the
      // close reason) would cycle forever with no backoff and no terminal
      // error. Surface it and stop.
      if (newHost === this.host) {
        const err = new Error(
          `zero hub reconnecting failed: redirect target \`${newHost}\` is the current host, not retrying`
        );
        this.logger.error(err.message);
        if (this.onZeroHubError) {
          this.onZeroHubError(err);
        }
        return;
      }
      this.logger.warn(
        `ZeroHub \`${this.host}\` is redirecting to \`${newHost}\`, reconnecting...`
      );
      // Mirror the backup-host branch below: update the client's host state,
      // not just this URL. Every entry point (createHub/joinHub/...) builds
      // its URL from `this.host`, so leaving it stale makes the next call
      // connect back to the migrating (or shut down) old host.
      this.host = newHost;
      // Keep hostIndex consistent: point at the redirected host when it is
      // in the configured list, so a later automatic failover starts from
      // here instead of the stale position; keep the previous index when it
      // is not.
      const redirectedIndex = this.hosts.indexOf(newHost);
      if (redirectedIndex !== -1) {
        this.hostIndex = redirectedIndex;
      }
      currentURL.host = newHost;
      this.connectToZeroHub(currentURL);
      return;
    }
    this.getZeroHubBackupHost()
      .then((newHost) => {
        // Re-check the flag inside the async callback: a user calling
        // disconnect() while this fetch is in flight would otherwise be
        // silently resurrected (connectToZeroHub resets isDisconnected).
        if (this.isDisconnected) {
          this.logger.log(
            "ZeroHub was disconnected during reconnect, aborting"
          );
          return;
        }
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
        if (this.onZeroHubError) {
          this.onZeroHubError(
            err instanceof Error ? err : new Error(String(err))
          );
        }
      });
  }

  /**
   * Parses JSON metadata received from the server, returning `fallback`
   * (with a warning logged) when the value is missing or malformed. The
   * server stores and broadcasts metadata from unvalidated query params,
   * so a bad value must never take down the message dispatcher.
   */
  private safeParseJson<T>(raw: string | undefined, fallback: T): T {
    const result = safeParseJson(raw, fallback);
    // Warn only when parsing genuinely failed (empty/malformed input),
    // never on a successful parse — a valid value can legitimately equal
    // the fallback, so reference equality can't tell the two apart.
    if (!result.ok) {
      this.logger.warn("invalid JSON metadata from server, using fallback");
    }
    return result.value;
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
        metadata: this.safeParseJson(hubInfoMsg.hubMetadata, {}) as HubMetadata,
        createTime: hubInfoMsg.createTime || new Date(),
      };
      if (this.onHubInfo) {
        this.onHubInfo(this.hubInfo);
      }

      // Reconcile the peer roster against the authoritative roster carried in
      // the hubInfo. The server sends the full current roster on every
      // (re)join, so it is the source of truth for who is in the hub right
      // now: add any peers we don't have yet, and prune any we still hold
      // that are no longer listed (and are not ourselves).
      const roster = new Set(hubInfoMsg.peers.map((peer) => peer.id));

      // Add any roster peer we don't have yet.
      for (const peer of hubInfoMsg.peers) {
        if (peer.id !== this.myPeerId && !(peer.id in this.peers)) {
          this.addPeer(peer.id, peer.metadata, peer.joinTime);
        }
      }

      // Prune any peer we still hold that is absent from the roster. This is
      // the auto-reconnect path: `connectToZeroHub` does not reset
      // `this.peers`, and a peer that left the hub while the WebSocket was
      // down is never told about via `peerDisconnectedMessage` (the server
      // only broadcasts it while we are connected). Without this pass such a
      // peer lingers as a stale `Peer` holding a live, unclosed
      // `RTCPeerConnection` — a resource leak and a source of duplicate/stale
      // WebRTC state for the same logical peer that grows with each transient
      // reconnect over a long-lived session. No transient-state guard is
      // needed: every peer in `this.peers` was learned from the server (the
      // hubInfo roster or a `peerJoinedMessage`, which the server only
      // broadcasts after registering the peer), so a peer missing from this
      // roster cannot be one that is merely registering.
      for (const peerId of Object.keys(this.peers)) {
        if (peerId !== this.myPeerId && !roster.has(peerId)) {
          this.logger.warn(
            `pruning stale peer ${peerId} not in the hub roster`
          );
          this.updatePeerStatus(peerId, PeerStatus.ZeroHubDisconnected);
          this.removePeer(peerId);
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
      } else {
        // Manual offer handling: surface the incoming offer to the
        // application so it can complete the exchange via
        // `sendAnswer(peer.id, offerSdp)`. Guard on the peer existing so a
        // dangling offer (peer already torn down) is not surfaced. The
        // `AnswerPending` status above fires before this callback.
        const peer = this.peers[offerPeerId];
        if (peer && this.onOffer) {
          this.onOffer(peer, offerSdp);
        }
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
      } else {
        // Manual answer handling: surface the incoming answer to the
        // application so it can complete the exchange via
        // `acceptAnswer(peer.id, answerSdp)`. Guard on the peer existing so a
        // dangling answer (peer already torn down) is not surfaced. The
        // `AcceptPending` status above fires before this callback.
        const peer = this.peers[answerPeerId];
        if (peer && this.onAnswer) {
          this.onAnswer(peer, answerSdp);
        }
      }
    } else if (serverMessage.peerJoinedMessage) {
      const peer = serverMessage.peerJoinedMessage.peer;
      if (!peer || !this.hubInfo || peer.id in this.peers) {
        return;
      }

      // The early-return guard above already skips peers we already have
      // (re-broadcast join signals, peers established via the initial hubInfo
      // path); the self-check mirrors the hubInfoMessage branch so we never
      // register ourselves.
      if (peer.id !== this.myPeerId) {
        this.addPeer(peer.id, peer.metadata, peer.joinTime);
      }
    } else if (serverMessage.peerDisconnectedMessage) {
      const peerId = serverMessage.peerDisconnectedMessage.peerId;

      // Fire the status change first so topology and user callbacks observe
      // the peer while it is still registered, then tear it down via the
      // shared removePeer path. (updatePeerStatus also logs when the peer is
      // unknown, which is the expected signal for a duplicate/delayed
      // disconnect broadcast.)
      this.updatePeerStatus(peerId, PeerStatus.ZeroHubDisconnected);

      this.removePeer(peerId);
    }
  }

  /**
   * Tears down a peer that is no longer in the hub: closes the underlying
   * WebRTC connection (releasing its ICE agents, sockets, and timers), nulls
   * the state handlers so a stale `oniceconnectionstatechange` cannot call
   * `restartIce()` on a closing connection (InvalidStateError), and removes
   * the peer from the map. Safe to call for a peer already gone from the
   * map: it is a no-op.
   *
   * Shared by the `peerDisconnectedMessage` broadcast path, the
   * `hubInfoMessage` roster-reconciliation path (pruning peers absent from
   * the authoritative roster after a reconnect), and `disconnect()`, so the
   * teardown semantics can never diverge again. The caller is responsible
   * for emitting the appropriate status first (`updatePeerStatus`), since
   * the status differs per path.
   *
   * @param peerId - The ID of the peer to tear down.
   */
  private removePeer(peerId: string): void {
    const peer = this.peers[peerId];
    if (!peer) {
      return;
    }
    peer.close();
    peer.rtcConn.onconnectionstatechange = null;
    peer.rtcConn.oniceconnectionstatechange = null;
    delete this.peers[peerId];
  }

  /**
   * Builds and registers a new peer with a fresh `RTCPeerConnection` and wires
   * both connection-state handlers, then marks the peer as `PeerStatus.Pending`.
   *
   * Both the initial-join (`hubInfoMessage`) and mid-session-join
   * (`peerJoinedMessage`) paths funnel through this helper so the wiring can
   * never diverge again:
   *
   * 1. `onconnectionstatechange` transitions the peer to `Connected` or
   *    `WebRTCDisconnected` as the underlying WebRTC connection state changes.
   * 2. `oniceconnectionstatechange` calls `restartIce()` when ICE reaches the
   *    `failed` state, recovering from NAT rebinding and candidate expiry.
   *
   * The caller is responsible for dedup guards (i.e. only invoking this when
   * the peer does not already exist) so an established peer is never
   * overwritten and its live `RTCPeerConnection` is not leaked.
   *
   * @param peerId - The unique identifier of the peer.
   * @param metadata - The raw JSON-encoded peer metadata from the server.
   * @param joinTime - The timestamp when the peer joined.
   */
  private addPeer(
    peerId: string,
    metadata: string,
    joinTime: Date | undefined
  ): void {
    const newPeer = new Peer<PeerMetadata>(
      peerId,
      PeerStatus.Pending,
      this.safeParseJson(metadata, {}) as PeerMetadata,
      joinTime || new Date(),
      new RTCPeerConnection(this.config.rtcConfig)
    );
    newPeer.rtcConn.onconnectionstatechange = (ev) => {
      this.logger.log("onconnectionstatechange", ev);
      if (newPeer.rtcConn.connectionState === "connected") {
        this.updatePeerStatus(peerId, PeerStatus.Connected);
      } else if (newPeer.rtcConn.connectionState === "disconnected") {
        this.updatePeerStatus(peerId, PeerStatus.WebRTCDisconnected);
      }
    };
    newPeer.rtcConn.oniceconnectionstatechange = (ev) => {
      // https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation#explicit_restartice_method_added
      this.logger.log("onconnectionstatechange", ev);
      if (newPeer.rtcConn.iceConnectionState === "failed") {
        newPeer.rtcConn.restartIce();
      }
    };

    this.peers[peerId] = newPeer;

    this.updatePeerStatus(peerId, PeerStatus.Pending);
  }

  /**
   * Closes the active WebSocket (if any) and clears it, without triggering
   * its auto-reconnect `onclose` handler or surfacing a spurious
   * `onZeroHubError` for the connection being intentionally replaced.
   *
   * Shared by `disconnect()` (manual teardown) and `connectToZeroHub`
   * (replacing a socket left open by a previous connection entry point that
   * did not go through `disconnect()`).
   */
  private closeActiveSocket() {
    if (!this.ws) {
      return;
    }
    const ws = this.ws;
    ws.onclose = null;
    ws.onerror = null;
    ws.onmessage = null;
    ws.onopen = null;
    ws.close(1000);
    delete this.ws;
  }

  /**
   * Connects to the ZeroHub using the provided URL and sets up WebSocket event handlers for receiving messages, errors, and close events.
   *
   * @param url - The URL of the ZeroHub to connect to
   */
  public connectToZeroHub(url: URL) {
    // Starting a fresh connection resets the manual-disconnect flag, so a
    // client that previously called disconnect() can be reused: a new
    // createHub()/joinHub() (or any other connection entry point) begins a
    // clean, live connection instead of a dead socket that still throws from
    // sendZeroHubMessage().
    //
    // NOTE: pending ICE candidate timeouts are intentionally NOT reset here.
    // disconnect() already clears them when the user manually disconnects, so
    // that path is covered. Preserving them across a reconnect keeps an
    // in-flight offer/answer send alive: the underlying RTCPeerConnection is
    // independent of the WebSocket, and its localDescription is already set,
    // so the armed timeout fires on the new socket (sendOnce uses this.ws).
    // The isSent guard in armSendOnIceReady() prevents double-sending if the
    // SDP already went out on the old socket.
    this.isDisconnected = false;

    // Tear down a socket left open by a previous connection (e.g. a second
    // entry-point call without disconnect()). Nulling the handlers before
    // close(1000) keeps the replaced socket from firing reconnect() — which
    // would advance hostIndex a second time for a single logical failure —
    // or onZeroHubError, for the connection we are intentionally replacing.
    this.closeActiveSocket();

    this.logger.log("connecting to ZeroHub:", url);

    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";
    this.ws.onmessage = (event: MessageEvent<Iterable<number>>) => {
      const serverMessage = ServerMessage.decode(new Uint8Array(event.data));
      this.logger.log("received zerohub message", serverMessage);
      this.handleZeroHubMessage(serverMessage);
    };
    // TODO: wait for error, close, or open to response promise result
    // Per RFC 6455, a network failure fires `error` and then `close` with
    // code 1006. Reconnection is handled solely in `onclose`: calling
    // `reconnect` here too would advance `hostIndex` twice for a single
    // failure (skipping two hosts) and orphan the first reconnection's
    // WebSocket while the client has already moved on.
    this.ws.onerror = (event) => {
      this.logger.error(`ZeroHub WebSocket error: ${JSON.stringify(event)}`);
      if (this.onZeroHubError) {
        this.onZeroHubError(
          Error(`ZeroHub WebSocket error: ${JSON.stringify(event)}`)
        );
      }
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
   * Disconnects from ZeroHub and tears down all peer connections.
   *
   * Closes the WebSocket to the signaling server, closes every
   * `RTCPeerConnection` in `this.peers`, clears pending ICE candidate timeout
   * timers, and transitions each peer to `PeerStatus.Disconnected`.
   * After calling `disconnect()`, the client will not attempt to
   * auto-reconnect to ZeroHub. The client can be reused by calling
   * `createHub()`/`joinHub()` (or any other connection entry point) again,
   * which establishes a fresh, live connection.
   */
  public disconnect() {
    this.isDisconnected = true;

    // clear pending ICE candidate timeouts so they cannot send to a closed socket
    Object.values(this.iceTimeouts).forEach((timeout) => {
      clearTimeout(timeout);
    });
    this.iceTimeouts = {};

    // close the WebSocket without triggering the auto-reconnect onclose handler
    this.closeActiveSocket();

    // transition peers to disconnected and close their WebRTC connections
    // (removePeer also removes them from the map, so the map is empty when
    // the loop finishes)
    for (const peerId of Object.keys(this.peers)) {
      this.updatePeerStatus(peerId, PeerStatus.Disconnected);
      this.removePeer(peerId);
    }
  }

  /**
   * Sends a message to ZeroHub.
   *
   * @param msg - the message to be sent to ZeroHub
   */
  public sendZeroHubMessage(msg: ClientMessage) {
    if (this.isDisconnected) {
      throw Error(
        "ZeroHub is disconnected, please connect again via `createHub` or `joinHub`"
      );
    }
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

    rtcOfferOptions = {
      ...this.config.rtcOfferOptions,
      ...rtcOfferOptions,
    };
    const peer = this.peers[peerId];
    if (!peer) {
      this.logger.error(`send offer error: peer id ${peerId} not found`);
      return;
    }

    // replace RTC config
    if (rtcConfig) {
      peer.rtcConn.setConfiguration(rtcConfig);
    }

    const offer = await peer.rtcConn.createOffer(rtcOfferOptions);
    await peer.rtcConn.setLocalDescription(offer);

    this.armSendOnIceReady(peerId, peer.rtcConn, () => {
      const localDescription = peer.rtcConn.localDescription;
      if (!localDescription) {
        return;
      }
      this.sendOfferToWebsocket(peerId, localDescription);
    });
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

    rtcOfferOptions = {
      ...this.config.rtcOfferOptions,
      ...rtcOfferOptions,
    };

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

    const offer = await peer.rtcConn.createAnswer(rtcOfferOptions);
    await peer.rtcConn.setLocalDescription(offer);

    this.armSendOnIceReady(peerId, peer.rtcConn, () => {
      const localDescription = peer.rtcConn.localDescription;
      if (!localDescription) {
        return;
      }
      this.sendAnswerToWebsocket(peerId, localDescription);
    });
  }

  /**
   * Wires the peer's `onicecandidate` handler plus a
   * `waitIceCandidatesTimeout` fallback so `sendOnce` is invoked exactly
   * once, as soon as the local description is ready:
   *
   * - `onicecandidate` fires the send on the first event that carries no
   *   candidate (the ICE candidate gathering complete marker), skipping any
   *   event that still carries a candidate.
   * - The timer fires the send if no such event arrives within
   *   `waitIceCandidatesTimeout` milliseconds.
   *
   * The two paths share a single `isSent` guard, so re-negotiation (or a
   * late candidate after the timeout) can never send the SDP a second time.
   * Re-arm clears the prior pending handle for `peerId` so
   * `disconnect()` cannot miss it and records the timer in
   * `this.iceTimeouts[peerId]`.
   *
   * @param peerId - The peer the SDP is destined for (the `iceTimeouts` key)
   * @param rtcConn - The peer's RTCPeerConnection
   * @param sendOnce - Invoked at most once to send the local SDP
   */
  private armSendOnIceReady(
    peerId: string,
    rtcConn: RTCPeerConnection,
    sendOnce: () => void
  ) {
    let isSent = false;

    rtcConn.onicecandidate = (event: {
      candidate?: RTCIceCandidate | null;
    }) => {
      if (!rtcConn.localDescription || isSent || event.candidate) {
        return;
      }

      isSent = true;
      sendOnce();
    };

    // stop waiting for ice candidates if longer than timeout
    // clear any prior pending handle so disconnect() cannot miss it
    const priorTimeout = this.iceTimeouts[peerId];
    if (priorTimeout) {
      clearTimeout(priorTimeout);
    }
    this.iceTimeouts[peerId] = setTimeout(() => {
      delete this.iceTimeouts[peerId];
      this.logger.warn("timeout waiting ICE candidates");
      if (!rtcConn.localDescription || isSent) {
        return;
      }

      isSent = true;
      sendOnce();
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
    this.openHubConnection("/v1/hubs/create", hubId, peerMetadata, hubMetadata);
  }

  /**
   * Join an existing hub on ZeroHub
   *
   * @param hubId - The id of the hub to join
   * @param peerMetadata - Peer metadata will share to each peer in the Hub
   */
  public joinHub(hubId: string, peerMetadata?: PeerMetadata) {
    this.openHubConnection("/v1/hubs/join", hubId, peerMetadata);
  }

  /**
   * Join an existing permanent hub on ZeroHub.
   * The Permanent Hub never expires; it is used for always-on
   * collaboration rooms.
   *
   * Note: permanent hubs are created out-of-band via the admin HTTP
   * endpoint `GET /v1/permanent-hubs/create` (requires the `Authorization`
   * header). The browser WebSocket API does not allow custom headers, so
   * the SDK cannot call that endpoint directly. Use an HTTP client (curl,
   * fetch from a Node.js process, etc.) to create a permanent hub before
   * calling `joinPermanentHub`.
   *
   * @param hubId - The id of the hub to join
   * @param peerMetadata - Peer metadata will share to each peer in the Hub
   */
  public joinPermanentHub(hubId: string, peerMetadata?: PeerMetadata) {
    this.openHubConnection("/v1/permanent-hubs/join", hubId, peerMetadata);
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
    this.openHubConnection(
      "/v1/hubs/join-or-create",
      hubId,
      peerMetadata,
      hubMetadata
    );
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
    this.openHubConnection(
      "/v1/ip-hubs/join-or-create",
      undefined,
      peerMetadata,
      hubMetadata
    );
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
    this.openHubConnection(
      "/v1/random-hubs/create",
      undefined,
      peerMetadata,
      hubMetadata
    );
  }

  /**
   * Join an existing Random Hub on ZeroHub
   *
   * @param hubId - The id of the hub to join
   * @param peerMetadata - Peer metadata will share to each peer in the Hub
   */
  public joinRandomHub(hubId: string, peerMetadata?: PeerMetadata) {
    this.openHubConnection("/v1/random-hubs/join", hubId, peerMetadata);
  }

  /**
   * Opens a WebSocket connection to a ZeroHub hub endpoint.
   *
   * Shared by all public hub entry points: assigns metadata, builds the
   * connection URL (with id/hubMetadata/peerMetadata query params as
   * applicable), and connects.
   *
   * @param path - The endpoint path (e.g. "/v1/hubs/create")
   * @param hubId - Optional hub id to send as the "id" query param
   * @param peerMetadata - Optional peer metadata
   * @param hubMetadata - Optional hub metadata
   */
  private openHubConnection(
    path: string,
    hubId?: string,
    peerMetadata?: PeerMetadata,
    hubMetadata?: HubMetadata
  ) {
    if (peerMetadata) {
      this.peerMetadata = peerMetadata;
    }
    if (hubMetadata) {
      this.hubMetadata = hubMetadata;
    }

    const url = new URL(path, getWS(this.host, this.config.tls));
    if (hubId !== undefined) {
      url.searchParams.set("id", hubId);
    }
    if (hubMetadata) {
      url.searchParams.set("hubMetadata", JSON.stringify(hubMetadata));
    }
    if (peerMetadata) {
      url.searchParams.set("peerMetadata", JSON.stringify(peerMetadata));
    }

    this.connectToZeroHub(url);
  }
}

/**
 * Safely parses a JSON string. Returns `fallback` when `raw` is empty or
 * when parsing fails, instead of throwing. The result is discriminated so
 * callers can tell a successful parse apart from a fallback, even when the
 * parsed value happens to equal the fallback.
 */
function safeParseJson<T>(
  raw: string | undefined,
  fallback: T
): { ok: boolean; value: T } {
  if (!raw) {
    return { ok: false, value: fallback };
  }
  try {
    return { ok: true, value: JSON.parse(raw) as T };
  } catch {
    return { ok: false, value: fallback };
  }
}

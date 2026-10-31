import {
  ALL_HOSTS_EXHAUSTED_ERROR_MESSAGE,
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
 * 2. **Connect** — Call one of the hub entry points (`createHub()`, `joinHub()`, `joinOrCreateHub()`, `joinPermanentHub()`, `createRandomHub()`, `joinRandomHub()`, `joinOrCreateIPHub()`) to establish a WebSocket connection. Each entry point returns a Promise that resolves when the signaling socket opens and rejects when the connection attempt fails. The client automatically handles reconnection with failover across multiple hosts.
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
 * // Awaiting resolves when the signaling WebSocket opens (and rejects
 * // when the connection attempt fails). The hub join itself — the
 * // server's `HubInfoMessage` with `myPeerId` and the peer roster —
 * // still completes when the `onHubInfo` callback fires, which happens
 * // shortly after the socket opens.
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
   * Number of same-host reconnect retries queued for the CURRENT host since
   * the last confirmed connection. Abnormal WebSocket closures (1006/1011)
   * schedule a retry to the SAME host with exponential backoff while this is
   * below `config.maxReconnectAttempts`; only when the budget is exhausted
   * does `reconnect()` fall through to host failover / the terminal
   * `onZeroHubError`. Reset to zero when a connection is confirmed (the
   * server's hub info arrives) or a migration redirect lands, so a
   * long-lived healthy session never accumulates backoff.
   */
  private reconnectAttempts = 0;
  /**
   * The pending same-host reconnect retry timer, or `null` when none is
   * queued. The timer callback carries the generation it was created with
   * and aborts when it no longer matches, so a timer that fires after the
   * state was reset (a confirmed connection) dials nowhere.
   */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Generation counter bumped every time the retry state is reset or the
   * timer fires; a stale timer compares its captured generation against this
   * value and aborts when they differ.
   */
  private reconnectTimerGeneration = 0;
  /**
   * Whether the client is still establishing its initial connection. True
   * for a new client (before the server's hub info has confirmed any
   * connection) and after `disconnect()` (a fresh session). Set to false when
   * the server's hub info confirms the first connection (the `onHubInfo`
   * boundary in `handleZeroHubMessage`, alongside the `reconnectRound` reset
   * there): hub info is the authoritative "the session is established"
   * signal, not a bare socket `onopen` (a dial that opens and is
   * immediately torn down is not a usable connection). Used by `reconnect()`
   * to decide whether to do a same-host retry (reconnect) or fail over
   * immediately (initial connection): the initial connection's failover is
   * pinned by `test/tests/multihosts.spec.ts` ("single connection failure
   * advances hostIndex exactly once"), so a dial that never confirmed a
   * session must not burn its same-host retry budget before failing over.
   */
  private isInitialConnection = true;
  /**
   * The current round of the host sweep. Incremented when the last configured
   * host's retry budget is exhausted and the client wraps back to the first
   * host, or when a redirected (non-configured) host's budget is exhausted
   * and the client wraps back to the configured list. Reset to zero when a
   * connection is confirmed (hub info arrives), when a migration redirect
   * lands on a fresh host, and on `disconnect()` — so the bounded wraparound
   * sweep is only ever consumed by a genuine outage, and the terminal error
   * stays reachable within the current sweep. The terminal
   * `onZeroHubError` fires only after `config.maxReconnectRounds` full
   * sweeps are exhausted, so a long-lived session survives transient outages
   * on every host instead of giving up after one pass through the list.
   */
  private reconnectRound = 0;
  /**
   * Whether the current `this.host` is one of the configured `hosts` (as
   * opposed to a migration-redirect target that is not in the list). True by
   * default (the initial host is the first configured host) and kept in sync
   * by `reconnect()`: set to the redirect target's list membership in the
   * 1001-migration-redirect branch, and back to true on every automatic
   * failover / wraparound hop (which always lands on a configured host).
   * Used to decide whether the current host is "the last configured host"
   * (eligible for the bounded wraparound sweep back to the start of the list)
   * or a redirected host that should get its own same-host retry budget
   * before the client wraps back to the configured list.
   */
  private inConfiguredHosts = true;
  /**
   * True once the terminal "all ZeroHub hosts are not working"
   * `onZeroHubError` has fired: the whole sweep budget is spent and further
   * abnormal closes on any leftover socket must be no-ops instead of
   * re-firing the terminal error or re-dialing (the application has been
   * told the session is dead; only a fresh entry-point call
   * (`createHub`/`joinHub`/...) — which clears this in `connectToZeroHub` —
   * may start a new session).
   */
  private reconnectAbandoned = false;
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
   *
   * Fired when a per-peer WebRTC signaling exchange fails on the peer's
   * `RTCPeerConnection`: creating/setting the offer SDP (`sendOffer`),
   * creating/setting the answer SDP (`sendAnswer`), or applying the remote
   * answer SDP (`acceptAnswer`) — e.g. an incompatible/invalid SDP or a
   * media-track failure. Transient signaling-socket delivery failures are
   * retried automatically and are not reported here. It is NOT a
   * peer-status notification (use `onPeerStatusChange` for lifecycle,
   * including P2P drops via `PeerStatus.WebRTCDisconnected`) and it is not
   * fired for connection-level errors (use `onZeroHubError`).
   *
   * @param peer - The peer the error occurred on
   * @param error - The error that occurred
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
   * Clears any queued same-host reconnect retry and resets the attempt
   * counter. Called when a connection is confirmed (the server's hub info
   * arrives), when a migration redirect lands, when the sweep wraps to the
   * first host / fails over to the next host, and on manual
   * `disconnect()` — so backoff never accumulates across a healthy session,
   * a redirected host gets its full retry budget, and a pending retry timer
   * can never resurface after an intentional teardown. `reconnectRound` is
   * deliberately NOT reset here: it is only ever reset at a confirmed
   * connection boundary (a hub info arriving, a migration redirect landing,
   * or `disconnect()`), never by a failover/wrap hop, so the bounded
   * wraparound sweep can't be restarted mid-outage and the terminal error
   * stays reachable within the current sweep.
   */
  private clearReconnectRetryState() {
    this.cancelPendingReconnectRetry();
    this.reconnectAttempts = 0;
  }

  /**
   * Re-dials `currentURL` on behalf of the auto-reconnect loop.
   *
   * `connectToZeroHub` returns a Promise that rejects when the dial fails.
   * For these internal re-dials that rejection is EXPECTED and intentionally
   * ignored: the socket's own `onerror` (surfaces `onZeroHubError`) and
   * `onclose` (routes to `reconnect` for the next attempt / host) already
   * drive the whole recovery, so there is nothing for a caller of this
   * promise to do. Swallowing the rejection keeps it from becoming an
   * unhandled promise rejection while preserving the existing reconnect
   * behaviour exactly.
   */
  private redial(currentURL: URL) {
    this.connectToZeroHub(currentURL).catch(() => {});
  }

  /**
   * Cancels any queued same-host reconnect retry timer. The generation bump
   * makes a stale pending timer abort even if it fires after the cancel.
   * `reconnectAttempts` is intentionally left untouched: the counter only
   * resets through `clearReconnectRetryState()` on a confirmed connection
   * (or a migration redirect), so a dial that will fail again keeps
   * consuming the same-host retry budget.
   */
  private cancelPendingReconnectRetry() {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectTimerGeneration += 1;
  }

  /**
   * The backoff delay for the `reconnectAttempts`-th same-host retry:
   * `reconnectBaseBackoffMs * 2^(attempts - 1)` with ±20% random jitter,
   * capped at 30 seconds (a longer delay would just delay failover or the
   * terminal error without improving the odds).
   */
  private reconnectBackoffDelayMs(attempts: number): number {
    const base =
      (this.config.reconnectBaseBackoffMs ?? 250) *
      2 ** Math.max(attempts - 1, 0);
    const jitter = 1 + (Math.random() * 2 - 1) * 0.2;
    return Math.min(30_000, Math.max(1, Math.round(base * jitter)));
  }

  /**
   * Queues a same-host reconnect retry `currentURL` after the current
   * backoff delay. `reconnectAttempts` counts how many retries are queued
   * (including this one); when it reaches `maxReconnectAttempts`, the next
   * abnormal close falls through to host failover instead.
   */
  private scheduleSameHostReconnect(currentURL: URL, reason: string) {
    const maxAttempts =
      this.config.maxReconnectAttempts ?? DEFAULT_CONFIG.maxReconnectAttempts;
    this.reconnectAttempts += 1;
    const generation = this.reconnectTimerGeneration;
    const delayMs = this.reconnectBackoffDelayMs(this.reconnectAttempts);
    this.logger.warn(
      `ZeroHub \`${this.host}\` reconnecting the same host (attempt ${this.reconnectAttempts}/${maxAttempts}) in ${delayMs}ms after ${reason}`
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      // The generation changed while the timer was pending: a connection was
      // confirmed or a manual disconnect happened. The state was already
      // reset, so dialing now would open a stray socket (and reset
      // isDisconnected). Abort.
      if (generation !== this.reconnectTimerGeneration) {
        return;
      }
      if (this.isDisconnected) {
        this.logger.log("ZeroHub was disconnected during reconnect, aborting");
        return;
      }
      this.redial(currentURL);
    }, delayMs);
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
    // User-supplied callbacks (topology handler, onPeerStatusChange) must not
    // take down the signaling dispatch that is notifying them: a throwing
    // handler must be isolated, consistent with reportPeerError. Without
    // these guards a single throwing user callback would abort
    // handleZeroHubMessage mid-stream and skip the remaining work for that
    // message (e.g. roster pruning, status updates for other peers).
    if (this.topology?.onPeerStatusChange) {
      try {
        this.topology.onPeerStatusChange(peer);
      } catch (err) {
        this.logger.error("topology.onPeerStatusChange handler threw", err);
      }
    }
    if (this.onPeerStatusChange) {
      try {
        this.onPeerStatusChange(peer);
      } catch (err) {
        this.logger.error("onPeerStatusChange handler threw", err);
      }
    }
  }

  /**
   * Surfaces a per-peer error to the `onPeerError` callback.
   *
   * The peer must still be registered (a peer torn down by
   * `removePeer` has no meaningful error channel — the status transition
   * to `ZeroHubDisconnected`/`Disconnected` via `onPeerStatusChange` is the
   * application's signal for those). A user-supplied handler that throws is
   * isolated from the rest of the signaling flow: it must not take down the
   * call stack that detected the error.
   *
   * @param peerId - The ID of the peer the error occurred on.
   * @param error - The error to surface.
   */
  private reportPeerError(peerId: string, error: Error): void {
    const peer = this.peers[peerId];
    if (!peer) {
      return;
    }
    if (this.onPeerError) {
      try {
        this.onPeerError(peer, error);
      } catch (err) {
        this.logger.error("onPeerError handler threw", err);
      }
    }
  }

  /**
   * Reconnects to ZeroHub after the active WebSocket closed.
   *
   * With a redirect host (`newHost`, the 1001 "going away" close reason):
   * the target must be a well-formed host AND different from the current
   * one (a self-redirect is an operator misconfiguration that would cycle
   * forever). A genuine migration redirect moves the client's host state to
   * the target and hands it a FULL same-host retry budget: a later abnormal
   * close on the redirected host (even one that is not in the configured
   * list) retries it with backoff instead of giving up immediately, and only
   * after that budget is spent does the client wrap back to the configured
   * host list.
   *
   * Without a redirect host (abnormal close, 1006/1011): the CURRENT host
   * (any position in the configured list) keeps a bounded retry budget
   * (`config.maxReconnectAttempts`) of same-host re-dials with exponential
   * backoff — a close is often a transient blip on a healthy host, and
   * long-lived sessions must survive it instead of failing over and
   * potentially landing on a host down for the same outage. Only when that
   * budget is spent does the client move on:
   *
   * - not on the last configured host → `hostIndex` advances to the next
   *   host (one logical failure advances it exactly once — pinned by
   *   `test/tests/multihosts.spec.ts`), and the new host gets a fresh
   *   retry budget;
   * - on the last configured host → the sweep wraps back to the FIRST
   *   host (`reconnectRound` advances), bounded by
   *   `config.maxReconnectRounds` full sweeps;
   * - every host's budget spent on every allowed sweep → the terminal
   *   failure surfaces via `onZeroHubError`.
   *
   * @param currentURL - The current URL of the ZeroHub connection.
   * @param newHost - An optional new host to connect to.
   */
  public reconnect(currentURL: URL, newHost?: string) {
    if (this.isDisconnected) {
      this.logger.log("ZeroHub is disconnected, skipping reconnect");
      return;
    }
    // The sweep budget is fully spent and the terminal `onZeroHubError` has
    // already fired: a later abnormal close on a leftover socket must be a
    // no-op instead of re-firing the terminal error or re-dialing. Only a
    // fresh entry-point call may start a new session (it clears this flag in
    // `connectToZeroHub`).
    if (this.reconnectAbandoned) {
      this.logger.log(
        "ZeroHub reconnection is abandoned (all hosts exhausted), ignoring close"
      );
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
      this.inConfiguredHosts = redirectedIndex !== -1;
      if (redirectedIndex !== -1) {
        this.hostIndex = redirectedIndex;
      }
      currentURL.host = newHost;
      // The redirect moved us to a fresh host: reset the same-host retry
      // budget (and any queued retry timer) so a later abnormal close on
      // the redirected host gets its full retry budget, not the remainder
      // of the previous host's. A migration redirect is a confirmed move to
      // a new host, so the wraparound sweep round resets too — the redirected
      // host (even one not in the configured list) gets its own retry
      // budget and its own sweep back to the configured list. It also ends
      // the initial-connection phase even when no hub info has ever
      // arrived on a configured host: from here on, an abnormal close on
      // the redirected host is a RECONNECT (same-host retry with backoff)
      // — the very acceptance case of the out-of-list migration target
      // flapping once — not the initial-connection failover, which would
      // abandon the server-directed host for a stale configured one.
      this.clearReconnectRetryState();
      this.reconnectRound = 0;
      this.isInitialConnection = false;
      this.redial(currentURL);
      return;
    }
    // Abnormal close with no redirect host.
    //
    // 1. Same-host retry — EVERY host (any position in the configured list,
    //    or a redirected out-of-list host) gets a bounded retry budget
    //    (`config.maxReconnectAttempts`) of same-host re-dials with
    //    exponential backoff before the client gives up on it: the close may
    //    be a transient blip (Wi-Fi handover, NAT/proxy hiccup, laptop
    //    sleep) on a host that is in fact healthy, and the SDK's long-lived
    //    sessions must survive those instead of tearing down permanently.
    //    Same-host retries leave `hostIndex` untouched, so the "a single
    //    logical failure advances hostIndex exactly once" invariant (pinned
    //    by `test/tests/multihosts.spec.ts`) still holds: only a
    //    budget-exhausted failure advances the index. A redirected
    //    out-of-list host retries ITSELF here instead of failing over to a
    //    stale configured host.
    //
    // 2. Host failover / wraparound — when the current host's retry budget
    //    is spent:
    //    - on a NON-last configured host → `hostIndex` advances to the next
    //      configured host, which gets a fresh retry budget;
    //    - on the LAST configured host (more than one configured) or on a
    //      redirected out-of-list host → the sweep wraps back to the FIRST
    //      configured host (bounded by `config.maxReconnectRounds` full
    //      sweeps) instead of giving up after one pass through the list.
    //    - every host's budget spent on every allowed sweep → the terminal
    //      `onZeroHubError` fires.
    const maxAttempts =
      this.config.maxReconnectAttempts ?? DEFAULT_CONFIG.maxReconnectAttempts;
    // A same-host retry is only for reconnects (the client has a confirmed
    // connection at some point); the initial connection fails over
    // immediately to the next host (pinned by
    // `test/tests/multihosts.spec.ts`). This means:
    //  - Initial connection: always fail over to the next host.
    //  - Reconnect: retry the same host if budget is available, otherwise
    //    fail over.
    if (!this.isInitialConnection && this.reconnectAttempts < maxAttempts) {
      this.scheduleSameHostReconnect(
        currentURL,
        "abnormal WebSocket close (1006/1011)"
      );
      return;
    }
    const maxRounds =
      this.config.maxReconnectRounds ?? DEFAULT_CONFIG.maxReconnectRounds;
    //
    // 2. Host failover — when the current host's retry budget is spent and
    //    it is NOT the last configured host, advance `hostIndex` to the next
    //    configured host, which gets a fresh retry budget of its own. Only a
    //    budget-exhausted failure advances the index; same-host retries leave
    //    it untouched, so the "a single logical failure advances hostIndex
    //    exactly once" invariant pinned by `test/tests/multihosts.spec.ts`
    //    still holds.
    const isLastConfigured = this.hostIndex >= this.hosts.length - 1;
    if (this.inConfiguredHosts && !isLastConfigured) {
      if (this.isDisconnected) {
        this.logger.log("ZeroHub was disconnected during reconnect, aborting");
        return;
      }
      this.hostIndex = this.hostIndex + 1;
      const nextHost = this.hosts[this.hostIndex];
      this.logger.warn(
        `ZeroHub \`${this.host}\` retry budget exhausted, failing over to the next host \`${nextHost}\``
      );
      this.clearReconnectRetryState();
      this.host = nextHost;
      this.inConfiguredHosts = true;
      currentURL.host = nextHost;
      this.redial(currentURL);
      return;
    }
    //
    // 3. Wraparound — when the LAST configured host's (with more than one
    //    configured) or a redirected out-of-list host's retry budget is
    //    spent and at least one more sweep round is allowed
    //    (`reconnectRound < maxRounds`), wrap back to the FIRST configured
    //    host instead of giving up after one pass through the list: a
    //    transient outage that partially clears mid-sweep recovers instead of
    //    permanently killing the session. Each host in the next pass gets a
    //    fresh retry budget; the round advances so the terminal error stays
    //    reachable once the wrap is spent. The re-dial is immediate (no
    //    backoff): the budget for the host we are leaving was just consumed.
    //    A wraparound only happens when there is more than one configured
    //    host: wrapping a single configured host to itself would just
    //    re-extend its own budget with no new host to try, and a redirected
    //    out-of-list host wraps back to the configured list, which is a
    //    genuinely different host.
    const isWrapCandidate =
      !this.inConfiguredHosts || (isLastConfigured && this.hosts.length > 1);
    if (isWrapCandidate && this.reconnectRound < maxRounds) {
      if (this.isDisconnected) {
        this.logger.log("ZeroHub was disconnected during reconnect, aborting");
        return;
      }
      this.logger.warn(
        `ZeroHub \`${this.host}\` retry budget exhausted, wrapping to the first host \`${this.hosts[0]}\` (round ${this.reconnectRound + 1}/${maxRounds})`
      );
      this.clearReconnectRetryState();
      this.reconnectRound += 1;
      this.hostIndex = 0;
      this.host = this.hosts[0];
      this.inConfiguredHosts = true;
      currentURL.host = this.hosts[0];
      this.redial(currentURL);
      return;
    }
    //
    // 4. Terminal — every host's budget is spent on every allowed sweep:
    //    the whole sweep budget is exhausted. Surface the terminal failure
    //    via `onZeroHubError`. This also covers the single-configured-host
    //    case (no other host to advance to, and wrapping to itself would
    //    just re-extend its own budget with no new host to try).
    //
    // Latch `reconnectAbandoned` so any later close on a leftover socket is
    // a no-op instead of re-firing the terminal error or re-dialing: the
    // application has been told the session is dead, and only a fresh
    // entry-point call (which clears the latch in `connectToZeroHub`) may
    // start a new one.
    this.reconnectAbandoned = true;
    const err = new Error(ALL_HOSTS_EXHAUSTED_ERROR_MESSAGE);
    this.logger.error(`zero hub reconnecting failed: ${err.message}`);
    if (this.onZeroHubError) {
      this.onZeroHubError(err);
    }
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

      // The server confirmed this connection: the same-host retry budget is
      // spent, reset it so the next abnormal close on a long-lived session
      // gets a full retry budget instead of the accumulated remainder. The
      // connection is confirmed, so the wraparound sweep budget resets too —
      // the next outage (if any) gets a full sweep instead of the remainder.
      // Hub info is also the moment the client leaves the initial-connection
      // phase: from now on, an abnormal close on the active socket is a
      // RECONNECT (same-host retry with backoff), not a first-dial failure
      // (which fails over to the next host immediately, pinned by
      // `test/tests/multihosts.spec.ts`). A bare socket `onopen` is not
      // enough — a dial that opens and is immediately torn down is not a
      // usable connection; the server's hub info is the confirmation.
      this.clearReconnectRetryState();
      this.reconnectRound = 0;
      this.isInitialConnection = false;

      this.myPeerId = hubInfoMsg.myPeerId;
      this.hubInfo = {
        id: hubInfoMsg.id,
        metadata: this.safeParseJson(hubInfoMsg.hubMetadata, {}) as HubMetadata,
        createTime: hubInfoMsg.createTime || new Date(),
      };
      if (this.onHubInfo) {
        try {
          this.onHubInfo(this.hubInfo);
        } catch (err) {
          // A throwing user callback must not abort the dispatch: the peer
          // roster reconciliation below still has to run for this message.
          this.logger.error("onHubInfo handler threw", err);
        }
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
    } else if (serverMessage.iceCandidateMessage) {
      const peerId = serverMessage.iceCandidateMessage.peerId;
      const peer = this.peers[peerId];
      if (!peer) {
        this.logger.error(
          `add ice candidate error: peer id ${peerId} not found`
        );
        return;
      }

      // The candidate arrives as a JSON string (the `RTCIceCandidate` shape the
      // sender serialized); parse it back so `addIceCandidate` receives the
      // `RTCIceCandidateInit` object it expects. The string is relayed verbatim
      // from any in-hub peer, so it goes through `safeParseJson`: a candidate is
      // disposable (the connection still converges via re-gathering/re-trickle),
      // and a poisoned value must never take down the message dispatcher.
      const candidate = this.safeParseJson(
        serverMessage.iceCandidateMessage.candidate,
        undefined
      ) as RTCIceCandidateInit | undefined;
      if (candidate) {
        peer.rtcConn.addIceCandidate(candidate).catch((err) => {
          this.logger.error("Failed to add ice candidate to peer", peerId, err);
        });
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
   * Tears down a peer that is no longer in the hub: clears its pending
   * ICE-candidate fallback timer and its pending P2P-drop recovery timer
   * (so a stale handle cannot fire later and attempt to send SDP or trigger
   * a recovery for a peer that is already gone), closes the underlying
   * WebRTC connection (releasing its ICE agents, sockets, and timers), nulls
   * the state handlers so a stale event cannot call back into the client on
   * a closing connection, and removes the peer from the map. Safe to call
   * for a peer already gone from the map: it is a no-op.
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
    // Clear any pending ICE-candidate fallback timer so it cannot fire later
    // and attempt to send SDP for a peer that is already gone.
    const pendingIce = this.iceTimeouts[peerId];
    if (pendingIce) {
      clearTimeout(pendingIce);
      delete this.iceTimeouts[peerId];
    }
    // Clear any pending P2P-drop recovery timer for the same reason: a
    // recovery fired after the peer is gone would call updatePeerStatus on
    // a removed peer and log a spurious "peer not found" error.
    const pendingRecovery = this.webRtcRecoveryTimeouts[peerId];
    if (pendingRecovery) {
      clearTimeout(pendingRecovery);
      delete this.webRtcRecoveryTimeouts[peerId];
    }
    peer.close();
    peer.rtcConn.onconnectionstatechange = null;
    peer.rtcConn.oniceconnectionstatechange = null;
    delete this.peers[peerId];
  }

  /**
   * Default delay before a P2P-drop recovery re-negotiation is started after
   * the peer's `RTCPeerConnection` reports `disconnected` / ICE `failed`.
   *
   * Browsers often recover from short-lived network blips (a wifi↔cellular
   * handover mid-negotiation, a laptop sleep/resume) by re-connecting the
   * existing ICE connection a few hundred milliseconds later — no new
   * candidate pair is needed. Deferring the recovery a beat lets that
   * natural recovery win and avoids two offer/answer pairs racing each
   * other when the connection state flaps quickly. The recovery is still
   * idempotent if it does run while the connection has already recovered
   * (re-negotiating a healthy connection is a harmless no-op for the data
   * path, and the status transitions are driven off live connection state,
   * not the stale event that queued this timer).
   */
  private static readonly WEBRTC_RECOVERY_DELAY_MS = 500;

  /**
   * Pending P2P-drop recovery timers, keyed by peer ID. A peer already has at
   * most one queued — `disconnected` and ICE `failed` both funnel through
   * `scheduleWebrtcRecovery`, so rapid flaps coalesce into a single
   * re-negotiation instead of racing.
   */
  private webRtcRecoveryTimeouts: {
    [peerId: string]: ReturnType<typeof setTimeout>;
  } = {};

  /**
   * Queues a P2P-drop recovery for `peerId`: after the fixed recovery delay
   * ({@link ZeroHubClient.WEBRTC_RECOVERY_DELAY_MS}), the peer is
   * transitioned to
   * `PeerStatus.WebRTCDisconnected` if it has not already recovered, which
   * triggers the topology's recovery path (a fresh offer/answer exchange over
   * the still-alive signaling socket). The peer must still be registered —
   * a peer the server told us to tear down (`ZeroHubDisconnected`) is gone
   * from the map, and there is nothing to recover.
   *
   * The status is read from the live connection at timer-fire time (not from
   * the stale `disconnected`/`failed` event that queued it), so a connection
   * that already recovered in the meantime is never marked disconnected.
   *
   * Shared by the `onconnectionstatechange` (`disconnected`) and
   * `oniceconnectionstatechange` (`failed`) handlers so the two signals can
   * never double-trigger a recovery. The `closed` state is the peer's own
   * teardown (`removePeer` / `close()`): no recovery can happen on a closed
   * connection, and the timer is cleared there so a late fire cannot call
   * `updatePeerStatus` on a removed peer.
   *
   * @param peerId - The peer whose P2P connection dropped.
   */
  private scheduleWebrtcRecovery(peerId: string) {
    const peer = this.peers[peerId];
    if (!peer) {
      return;
    }
    // A connection that is closed or closing has no recovery path: the
    // teardown already nulls both state handlers, so guard the timer too.
    if (peer.rtcConn.connectionState === "closed") {
      return;
    }
    // A connection that has not completed its initial offer/answer exchange
    // has no established P2P link to recover: `remoteDescription` stays
    // null until the first exchange lands (the offer on the answerer's side,
    // the answer on the offerer's side). A pre-negotiation
    // `disconnected`/`failed` is a first-time negotiation failure, not a
    // drop, and re-offering here would race the in-flight initial
    // negotiation.
    if (!peer.rtcConn.remoteDescription) {
      return;
    }
    const existing = this.webRtcRecoveryTimeouts[peerId];
    if (existing) {
      clearTimeout(existing);
    }
    this.webRtcRecoveryTimeouts[peerId] = setTimeout(() => {
      delete this.webRtcRecoveryTimeouts[peerId];
      const current = this.peers[peerId];
      if (!current) {
        return;
      }
      // Re-read the live state: the connection may have recovered (or been
      // closed) while this timer was pending.
      const state = current.rtcConn.connectionState;
      if (state === "connected" || state === "closed") {
        return;
      }
      this.logger.warn(
        `P2P connection to peer ${peerId} is ${state}, recovering via re-negotiation`
      );
      this.updatePeerStatus(peerId, PeerStatus.WebRTCDisconnected);
    }, ZeroHubClient.WEBRTC_RECOVERY_DELAY_MS);
  }

  /**
   * Builds and registers a new peer with a fresh `RTCPeerConnection` and wires
   * both connection-state handlers, then marks the peer as `PeerStatus.Pending`.
   *
   * Both the initial-join (`hubInfoMessage`) and mid-session-join
   * (`peerJoinedMessage`) paths funnel through this helper so the wiring can
   * never diverge again:
   *
   * 1. `onconnectionstatechange` transitions the peer to `Connected` when the
   *    underlying WebRTC connection recovers/connects, and queues a P2P-drop
   *    recovery (`scheduleWebrtcRecovery`) when it reports
   *    `disconnected` — the topology's `WebRTCDisconnected` handling then
   *    re-negotiates over the still-alive signaling socket.
   * 2. `oniceconnectionstatechange` queues the same recovery when ICE reaches
   *    the `failed` state (NAT rebinding, candidate expiry). The local
   *    `restartIce()` from the
   *    [Perfect negotiation](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation#explicit_restartice_method_added)
   *    pattern is NOT sufficient on its own: it only changes the local ICE
   *    ufrag, and the remote peer can only learn the new ufrag through a
   *    re-negotiation (a new offer/answer carrying the new ICE ufrag in the
   *    SDP) — which is exactly what the recovery path issues.
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
    newPeer.rtcConn.onconnectionstatechange = () => {
      const state = newPeer.rtcConn.connectionState;
      this.logger.log("onconnectionstatechange", state);
      if (state === "connected") {
        this.updatePeerStatus(peerId, PeerStatus.Connected);
      } else if (state === "disconnected") {
        this.scheduleWebrtcRecovery(peerId);
      }
    };
    newPeer.rtcConn.oniceconnectionstatechange = () => {
      const state = newPeer.rtcConn.iceConnectionState;
      this.logger.log("oniceconnectionstatechange", state);
      if (state === "failed") {
        this.scheduleWebrtcRecovery(peerId);
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
   * The returned Promise settles exactly once: it resolves when the
   * WebSocket opens, and rejects on the first `error` event or a `close`
   * event with a code other than 1000/1001/1006/1011. The 1006/1011
   * branches of `onclose` do NOT settle the Promise: they are the
   * auto-reconnect entry point (failover to the next host / same-host
   * backoff retry), and the outcome of that recovery is already surfaced
   * through `onZeroHubError` (terminal) or the follow-up connection's own
   * events — settling here would make a caller await a connection the
   * client is already in the middle of abandoning.
   *
   * `error` and `close` can both fire for a single failure (an aborted
   * dial emits `error` and then `close` with code 1006 per RFC 6455); the
   * one-shot `settle` guard keeps the Promise from settling twice.
   *
   * @param url - The URL of the ZeroHub to connect to
   * @returns A Promise that resolves when the WebSocket opens and rejects
   *   on a connection `error` or an abnormal `close` (any code other than
   *   1000, 1001, 1006, 1011).
   */
  public connectToZeroHub(url: URL): Promise<void> {
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

    // A fresh dial supersedes any queued same-host retry timer: cancel it
    // (and bump the generation so a stale pending timer aborts) so its
    // callback can never dial a SECOND socket while this one is being
    // established. This covers a manual re-entry — createHub()/joinHub()
    // called while a retry is pending. The attempt COUNTER is deliberately
    // NOT reset here: the budget only refills when a connection is
    // CONFIRMED (the server's hub info arrives), so a dial that will fail
    // again still consumes budget and the terminal error stays reachable.
    //
    // The `reconnectAbandoned` latch clears here: a fresh entry-point call
    // is the only thing that may start a new session after the terminal
    // "all hosts exhausted" error fired — the application has explicitly
    // chosen to (re)connect.
    this.cancelPendingReconnectRetry();
    this.reconnectAbandoned = false;

    // Tear down a socket left open by a previous connection (e.g. a second
    // entry-point call without disconnect()). Nulling the handlers before
    // close(1000) keeps the replaced socket from firing reconnect() — which
    // would advance hostIndex a second time for a single logical failure —
    // or onZeroHubError, for the connection we are intentionally replacing.
    this.closeActiveSocket();

    this.logger.log("connecting to ZeroHub:", url);

    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";

    // The connect Promise: it resolves when the WebSocket opens and rejects
    // on a connection `error` or an abnormal `close`. `error` and `close`
    // can both fire for a single failure (an aborted dial emits `error` and
    // then `close` with code 1006 per RFC 6455), and both map to a
    // rejection, so `settle` is one-shot: the second event is a no-op on the
    // already-settled Promise. The executor runs in a closure, so the
    // handlers read the socket through `socket` (a local reference) instead
    // of `this.ws`, which TypeScript cannot narrow across the boundary.
    const socket = this.ws;
    const connectPromise = new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (error?: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };

      socket.onmessage = (event: MessageEvent<Iterable<number>>) => {
        try {
          const serverMessage = ServerMessage.decode(
            new Uint8Array(event.data)
          );
          this.logger.log("received zerohub message", serverMessage);
          this.handleZeroHubMessage(serverMessage);
        } catch (err) {
          // A corrupt/truncated frame (a `ServerMessage.decode` failure) or a
          // failure inside the dispatcher must never escape the WebSocket
          // `onmessage` handler: an uncaught throw here would take down the
          // signaling receive loop for every peer in the hub. Isolate the
          // failure — log it and surface a connection-level error (the
          // signaling link is compromised) — and keep the socket able to
          // process the next frame. The individual user-callback guards
          // inside `handleZeroHubMessage`/`updatePeerStatus` already keep one
          // bad callback from skipping the rest of the dispatch; this outer
          // catch is the last line of defense for the decode path and
          // anything else.
          this.logger.error("failed to process ZeroHub message", err);
          try {
            if (this.onZeroHubError) {
              this.onZeroHubError(
                err instanceof Error ? err : new Error(String(err))
              );
            }
          } catch (handlerErr) {
            // The user's onZeroHubError handler throwing must not escape the
            // event handler either (same isolation rule as reportPeerError).
            this.logger.error("onZeroHubError handler threw", handlerErr);
          }
        }
      };
      // Per RFC 6455, a network failure fires `error` and then `close` with
      // code 1006. Reconnection is handled solely in `onclose`: calling
      // `reconnect` here too would advance `hostIndex` twice for a single
      // failure (skipping two hosts) and orphan the first reconnection's
      // WebSocket while the client has already moved on.
      //
      // The error also settles the connect Promise: a dial that fails before
      // it ever opens (DNS failure, connection refused) must reject, not
      // resolve. The one-shot `settle` guard makes the follow-up `close`
      // (which routes to the auto-reconnect path below, not to `settle`)
      // unable to settle the Promise a second time.
      socket.onerror = (event) => {
        this.logger.error(`ZeroHub WebSocket error: ${JSON.stringify(event)}`);
        if (this.onZeroHubError) {
          this.onZeroHubError(
            Error(`ZeroHub WebSocket error: ${JSON.stringify(event)}`)
          );
        }
        settle(new Error(`ZeroHub WebSocket error: ${JSON.stringify(event)}`));
      };
      socket.onclose = (event) => {
        // See https://www.rfc-editor.org/rfc/rfc6455#section-7.4.1
        switch (event.code) {
          case 1000:
            // A clean close: the caller initiated it (or the server ended
            // the session normally) — the connect Promise is already settled
            // (or was never awaited for this socket), so nothing to do.
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
            // Any other close code is a protocol-level failure: reject the
            // connect Promise (if it is still pending) in addition to the
            // existing onZeroHubError surface.
            if (this.onZeroHubError) {
              this.onZeroHubError(
                Error(
                  `ZeroHub error code \`${event.code}\` reason \`${event.reason}\``
                )
              );
            }
            settle(
              new Error(
                `ZeroHub error code \`${event.code}\` reason \`${event.reason}\``
              )
            );
            break;
        }
      };
      socket.onopen = () => {
        settle();
      };
    });

    return connectPromise;
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

    // Cancel any queued same-host reconnect retry: the timer would otherwise
    // fire after teardown and dial a stray socket (connectToZeroHub resets
    // isDisconnected, resurrecting a manually disconnected client). The
    // sweep round resets too, so a client reused via a later entry-point call
    // starts with a full wraparound budget, not the remainder of the torn-
    // down session's. `isInitialConnection` is deliberately NOT reset: a
    // reused client has already established a connection once, so a dial
    // failure on a later entry point is a reconnect (same-host retry with
    // backoff), not the initial-connection failover.
    this.clearReconnectRetryState();
    this.reconnectRound = 0;

    // clear pending ICE candidate timeouts so they cannot send to a closed socket
    Object.values(this.iceTimeouts).forEach((timeout) => {
      clearTimeout(timeout);
    });
    this.iceTimeouts = {};

    // clear pending P2P-drop recovery timers for the same reason
    Object.values(this.webRtcRecoveryTimeouts).forEach((timeout) => {
      clearTimeout(timeout);
    });
    this.webRtcRecoveryTimeouts = {};

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
   * @throws When the client is manually disconnected, when no socket exists,
   *   or when the socket is present but not yet OPEN (a CONNECTING or
   *   CLOSING socket). Without this last guard, `ws.send()` throws a raw
   *   `InvalidStateError` — and in a `CONNECTING` window (the reconnection
   *   handshake is in flight) that escape can tear down the calling event
   *   handler while the message is silently lost.
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
    if (this.ws.readyState !== WebSocket.OPEN) {
      throw new Error(
        "ZeroHub WebSocket is not open (reconnecting?); message not sent"
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
   * Trickle an ICE candidate to a peer over the signaling channel.
   *
   * Candidates are forwarded as their JSON representation (the
   * `RTCIceCandidate` shape), which the remote applies via
   * `addIceCandidate`.
   *
   * @param peerId - The peer to send the candidate to
   * @param candidate - The trickled ICE candidate
   */
  public sendIceCandidateToWebsocket(
    peerId: string,
    candidate: RTCIceCandidate
  ) {
    this.sendZeroHubMessage({
      sendIceCandidateMessage: {
        peerId,
        // `toJSON()` is the spec-correct `RTCIceCandidateInit` serialization
        // (plain `JSON.stringify` omits `sdpMid`/`sdpMLineIndex` when
        // undefined, and the remote's `addIceCandidate` rejects such a
        // candidate).
        candidate: JSON.stringify(
          typeof candidate.toJSON === "function"
            ? candidate.toJSON()
            : candidate
        ),
      },
    });
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

    try {
      const offer = await peer.rtcConn.createOffer(rtcOfferOptions);
      await peer.rtcConn.setLocalDescription(offer);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error("Failed to create offer for peer", peerId, error);
      this.reportPeerError(peerId, error);
      // Re-throw: callers (topology, user code) still observe the failed
      // exchange via the rejected promise; onPeerError is additive.
      throw error;
    }

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

    try {
      await peer.rtcConn.setRemoteDescription({
        type: "offer",
        sdp: offerSdp,
      });

      const offer = await peer.rtcConn.createAnswer(rtcOfferOptions);
      await peer.rtcConn.setLocalDescription(offer);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error("Failed to create answer for peer", peerId, error);
      this.reportPeerError(peerId, error);
      // Re-throw: callers (topology, user code) still observe the failed
      // exchange via the rejected promise; onPeerError is additive.
      throw error;
    }

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
   * - The first candidate-bearing event (or the candidate-less gathering-
   *   complete marker) fires the SDP send exactly once; every candidate-
   *   bearing event is also trickled to the remote peer via
   *   `sendIceCandidateToWebsocket`, including all candidates that arrive
   *   AFTER the SDP has gone out.
   * - The timer fires the send if no candidate event arrives within
   *   `waitIceCandidatesTimeout` milliseconds (candidates trickling in after
   *   the timeout are still forwarded).
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

    // The SDP send is best-effort: it can throw while the signaling socket
    // is CONNECTING (the reconnection handshake is in flight) — a window in
    // which `sendZeroHubMessage` rejects with a clean error instead of a raw
    // `InvalidStateError`. Swallowing the throw here serves two purposes:
    // no exception escapes out of the onicecandidate/timer event handlers,
    // and `isSent` is only set AFTER `sendOnce` completed, so a failed
    // attempt does not consume the single-send guard: a later candidate
    // (or the ICE-timeout fallback) still delivers the SDP exactly once
    // instead of the peer stalling in Pending/Offering forever.
    const trySendOnce = () => {
      if (isSent) {
        return;
      }
      try {
        sendOnce();
      } catch (err) {
        // A non-OPEN socket (or the manual-disconnect throw) consumed this
        // attempt without delivering the SDP; keep the guard open so a
        // later event on an open socket can still deliver it.
        this.logger.warn(
          `failed to send SDP for peer ${peerId}, will retry on a later event`,
          err
        );
        return;
      }
      isSent = true;
    };

    rtcConn.onicecandidate = (event: {
      candidate?: RTCIceCandidate | null;
    }) => {
      // The candidate-less event is the gathering-complete marker: it fires
      // the SDP send exactly once.
      if (!event.candidate) {
        if (rtcConn.localDescription) {
          trySendOnce();
        }
        return;
      }

      // Trickle ICE: forward every candidate the connection trickles in. The
      // first candidate (ready at the moment the SDP went out) also rides the
      // signaling channel — the remote applies it via `addIceCandidate`, so
      // it is never silently dropped.
      trySendOnce();
      try {
        this.sendIceCandidateToWebsocket(peerId, event.candidate);
      } catch (err) {
        // The signaling socket is not OPEN (e.g. the reconnection
        // handshake is in flight): this candidate is dropped rather than
        // retry-queued, but the error must never escape the onicecandidate
        // event handler — log the loss instead of tearing down the
        // event loop's dispatch.
        this.logger.warn(
          `dropping ICE candidate for peer ${peerId}: signaling socket not open`,
          err
        );
      }
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
      if (!rtcConn.localDescription) {
        return;
      }

      trySendOnce();
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

    try {
      await peer.rtcConn.setRemoteDescription({
        type: "answer",
        sdp: answerSdp,
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error("Failed to accept answer from peer", peerId, error);
      this.reportPeerError(peerId, error);
      // Re-throw: callers (the auto-accept path, user code) still observe
      // the failed exchange via the rejected promise; onPeerError is
      // additive.
      throw error;
    }
  }

  /**
   *  Creates a new hub on ZeroHub
   *
   *
   * @param hubId - The id of the hub to create
   * @param peerMetadata - Peer metadata will share to each peer in the Hub
   * @param hubMetadata - Hub metadata will share to each peer in the Hub
   * @returns A Promise that resolves when the signaling WebSocket opens and
   *   rejects when the connection attempt fails. Hub join state
   *   (`myPeerId`, `peers`, `hubInfo`) is populated when the `onHubInfo`
   *   callback fires.
   */
  public createHub(
    hubId: string,
    peerMetadata?: PeerMetadata,
    hubMetadata?: HubMetadata
  ): Promise<void> {
    return this.openHubConnection(
      "/v1/hubs/create",
      hubId,
      peerMetadata,
      hubMetadata
    );
  }

  /**
   * Join an existing hub on ZeroHub
   *
   * @param hubId - The id of the hub to join
   * @param peerMetadata - Peer metadata will share to each peer in the Hub
   * @returns A Promise that resolves when the signaling WebSocket opens and
   *   rejects when the connection attempt fails. Hub join state
   *   (`myPeerId`, `peers`, `hubInfo`) is populated when the `onHubInfo`
   *   callback fires.
   */
  public joinHub(hubId: string, peerMetadata?: PeerMetadata): Promise<void> {
    return this.openHubConnection("/v1/hubs/join", hubId, peerMetadata);
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
   * @returns A Promise that resolves when the signaling WebSocket opens and
   *   rejects when the connection attempt fails. Hub join state
   *   (`myPeerId`, `peers`, `hubInfo`) is populated when the `onHubInfo`
   *   callback fires.
   */
  public joinPermanentHub(
    hubId: string,
    peerMetadata?: PeerMetadata
  ): Promise<void> {
    return this.openHubConnection(
      "/v1/permanent-hubs/join",
      hubId,
      peerMetadata
    );
  }

  /**
   * Join an existing hub or create if not on ZeroHub
   *
   * @param hubId - The id of the hub to join or create
   * @param peerMetadata - Peer metadata will share to each peer in the Hub
   * @param hubMetadata - (will only use if no hub exist) Hub metadata will share to each peer in the Hub
   *
   * @returns A Promise that resolves when the signaling WebSocket opens and
   *   rejects when the connection attempt fails. Hub join state
   *   (`myPeerId`, `peers`, `hubInfo`) is populated when the `onHubInfo`
   *   callback fires.
   */
  public joinOrCreateHub(
    hubId: string,
    peerMetadata?: PeerMetadata,
    hubMetadata?: HubMetadata
  ): Promise<void> {
    return this.openHubConnection(
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
   * @returns A Promise that resolves when the signaling WebSocket opens and
   *   rejects when the connection attempt fails. Hub join state
   *   (`myPeerId`, `peers`, `hubInfo`) is populated when the `onHubInfo`
   *   callback fires.
   */
  public joinOrCreateIPHub(
    peerMetadata?: PeerMetadata,
    hubMetadata?: HubMetadata
  ): Promise<void> {
    return this.openHubConnection(
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
   * @returns A Promise that resolves when the signaling WebSocket opens and
   *   rejects when the connection attempt fails. Hub join state
   *   (`myPeerId`, `peers`, `hubInfo`) is populated when the `onHubInfo`
   *   callback fires.
   */
  public createRandomHub(
    peerMetadata?: PeerMetadata,
    hubMetadata?: HubMetadata
  ): Promise<void> {
    return this.openHubConnection(
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
   * @returns A Promise that resolves when the signaling WebSocket opens and
   *   rejects when the connection attempt fails. Hub join state
   *   (`myPeerId`, `peers`, `hubInfo`) is populated when the `onHubInfo`
   *   callback fires.
   */
  public joinRandomHub(
    hubId: string,
    peerMetadata?: PeerMetadata
  ): Promise<void> {
    return this.openHubConnection("/v1/random-hubs/join", hubId, peerMetadata);
  }

  /**
   * Opens a WebSocket connection to a ZeroHub hub endpoint.
   *
   * Shared by all public hub entry points: builds the connection URL (with
   * id/hubMetadata/peerMetadata query params as applicable), and connects.
   *
   * @param path - The endpoint path (e.g. "/v1/hubs/create")
   * @param hubId - Optional hub id to send as the "id" query param
   * @param peerMetadata - Optional peer metadata
   * @param hubMetadata - Optional hub metadata
   * @returns The connection Promise from `connectToZeroHub`.
   */
  private openHubConnection(
    path: string,
    hubId?: string,
    peerMetadata?: PeerMetadata,
    hubMetadata?: HubMetadata
  ): Promise<void> {
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

    return this.connectToZeroHub(url);
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

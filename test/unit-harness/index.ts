/**
 * Unit-test harness for the ZeroHub client.
 *
 * This module is bundled (see `test/scripts/build-unit-harness.mjs`) and
 * injected into a Playwright page via `page.addInitScript`. It:
 *
 *  1. Installs a mock `RTCPeerConnection` on the global scope *before* the
 *     client is ever driven, so every `new RTCPeerConnection(...)` the client
 *     creates (inside `addPeer`) is a mock we can inspect and simulate.
 *  2. Exposes `window.ZeroHubUnitHarness`, a tiny driver that lets the specs
 *     construct a client (with a no-op topology, to avoid real WebRTC /
 *     data-channel / sendOffer side effects) and feed it the raw
 *     `ServerMessage` shapes that `handleZeroHubMessage` consumes.
 *
 * Only the pure message-handling / peer-wiring logic is exercised here — no
 * network, no server, no real WebRTC stack.
 */
import {
  ZeroHubClient,
  LogLevel,
  Topology,
  SFUTopology,
  Peer,
  PeerStatus,
} from "../../client/src/index";
import { getWS } from "../../client/src/utils";
import { ClientMessage } from "../../client/src/proto/zerohub/v1/client_message";

let instanceSeq = 0;
const createdInstances: MockRTCPeerConnection[] = [];

/** Cast a client connection to the mock we installed. */
function asMock(
  conn: RTCPeerConnection | undefined | null
): MockRTCPeerConnection | undefined {
  return conn as unknown as MockRTCPeerConnection | undefined;
}

/**
 * A minimal stand-in for the browser `WebSocket`.
 *
 * Mirrors just the surface `ZeroHubClient` touches: `binaryType`, the
 * `onmessage` / `onerror` / `onclose` / `onopen` handler slots, `close()`,
 * and `send()`. Each instance is tagged with a unique `__instanceId` and
 * records `close()` call codes so specs can detect leaked/orphaned sockets
 * (a replaced socket that was never closed and still carries handlers).
 */
class MockWebSocket {
  /** Unique per-instance id used to detect reuse vs. replacement. */
  public readonly __instanceId: number;
  /** The URL string the socket was opened with. */
  public readonly url: string;
  public binaryType: string;
  /** Set by the client; nulled by `closeActiveSocket` on teardown. */
  public onmessage: ((event: unknown) => void) | null;
  public onerror: ((event: unknown) => void) | null;
  public onclose: ((event: { code: number; reason: string }) => void) | null;
  public onopen: (() => void) | null;
  /** Close codes passed to `close()` (inspectable by specs). */
  public readonly __closeCalls: number[];
  /** Whether `close()` has been called. */
  public __closed: boolean;

  constructor(url: string | URL) {
    this.__instanceId = ++wsInstanceSeq;
    wsInstances.push(this);
    this.url = String(url);
    this.binaryType = "blob";
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    this.onopen = null;
    this.__closeCalls = [];
    this.__closed = false;
  }

  close(code?: number): void {
    this.__closed = true;
    this.__closeCalls.push(code ?? 1000);
  }

  send(_data: unknown): void {
    // no-op
  }
}

let wsInstanceSeq = 0;
const wsInstances: MockWebSocket[] = [];

// Install the mock *before* any client-driven `new WebSocket(url)` runs. The
// client only opens sockets at runtime (inside `connectToZeroHub`), so this
// assignment is in time.
(globalThis as { WebSocket: unknown }).WebSocket = MockWebSocket;

/**
 * A minimal stand-in for the browser `RTCPeerConnection`.
 *
 * Mirrors just the surface `ZeroHubClient` touches: the `connectionState` /
 * `iceConnectionState` properties, the `onconnectionstatechange` /
 * `oniceconnectionstatechange` handler slots, `restartIce()`, `close()`, and a
 * couple of no-op negotiation methods. Each instance is tagged with a unique
 * `__instanceId` so specs can detect whether a peer's live connection was
 * reused or replaced (leaked).
 */
class MockRTCPeerConnection {
  /** Unique per-instance id used to detect reuse vs. replacement. */
  public readonly __instanceId: number;
  /** Read as `connectionState`; mutated by specs then the handler is fired. */
  public connectionState: string;
  /** Read as `iceConnectionState`; mutated by specs then the handler is fired. */
  public iceConnectionState: string;
  public localDescription: { type: string; sdp: string } | null;
  /** Set by the client; invoked by specs to simulate a connection-state change. */
  public onconnectionstatechange: ((ev: Event) => void) | null;
  /** Set by the client; invoked by specs to simulate an ICE-state change. */
  public oniceconnectionstatechange: ((ev: Event) => void) | null;
  public ondatachannel: ((ev: unknown) => void) | null;
  public ontrack: ((ev: unknown) => void) | null;
  public onicecandidate: ((ev: unknown) => void) | null;
  /** Number of `restartIce()` calls (inspectable by specs). */
  public __restartIceCount: number;
  /** Whether `close()` has been called. */
  public __closed: boolean;

  constructor(_config?: RTCConfiguration) {
    this.__instanceId = ++instanceSeq;
    createdInstances.push(this);
    this.connectionState = "new";
    this.iceConnectionState = "new";
    this.localDescription = null;
    this.onconnectionstatechange = null;
    this.oniceconnectionstatechange = null;
    this.ondatachannel = null;
    this.ontrack = null;
    this.onicecandidate = null;
    this.__restartIceCount = 0;
    this.__closed = false;
  }

  restartIce(): void {
    this.__restartIceCount += 1;
  }

  close(): void {
    this.__closed = true;
  }

  addTrack(): void {
    // no-op
  }

  addTransceiver(): void {
    // no-op
  }

  createDataChannel(label: string): { label: string } {
    return { label };
  }

  /** Options last passed to `createOffer` (inspectable by specs). */
  public __lastCreateOfferOptions: RTCOfferOptions | null = null;
  /** Options last passed to `createAnswer` (inspectable by specs). */
  public __lastCreateAnswerOptions: RTCOfferOptions | null = null;
  /** `setRemoteDescription` calls (inspectable by specs). */
  public __remoteDescriptions: Array<{ type: string; sdp: string }> = [];
  /** `addIceCandidate` arguments (inspectable by specs). */
  public __addedIceCandidates: Array<string> = [];

  createOffer(options?: RTCOfferOptions): Promise<{ type: string; sdp: string }> {
    this.__lastCreateOfferOptions = options ?? null;
    return Promise.resolve({ type: "offer", sdp: "offer-sdp" });
  }

  /** `RTCIceCandidate`-shaped objects as passed to `addIceCandidate`. */
  addIceCandidate(candidate?: unknown): Promise<void> {
    if (candidate) {
      this.__addedIceCandidates.push(JSON.stringify(candidate));
    }
    return Promise.resolve();
  }

  createAnswer(options?: RTCOfferOptions): Promise<{ type: string; sdp: string }> {
    this.__lastCreateAnswerOptions = options ?? null;
    return Promise.resolve({ type: "answer", sdp: "answer-sdp" });
  }

  setLocalDescription(desc?: { type: string; sdp: string }): Promise<void> {
    if (desc) {
      this.localDescription = desc;
    }
    return Promise.resolve();
  }

  setRemoteDescription(
    desc?: { type: string; sdp: string }
  ): Promise<void> {
    if (desc) {
      this.__remoteDescriptions.push({ type: desc.type, sdp: desc.sdp });
    }
    return Promise.resolve();
  }
}

// Install the mock *before* any client-driven `new RTCPeerConnection(...)`
// runs. The client module (imported above) only creates connections at runtime
// (inside `addPeer`), so this assignment is in time.
(globalThis as { RTCPeerConnection: unknown }).RTCPeerConnection =
  MockRTCPeerConnection;

/** A topology that records nothing and triggers no WebRTC side effects. */
class NoopTopology implements Topology {
  public zeroHub: ZeroHubClient | undefined;
  init(zeroHub: ZeroHubClient): void {
    this.zeroHub = zeroHub;
  }
  onPeerStatusChange(): void {
    // intentionally empty — avoid createDataChannel / sendOffer
  }
}

interface PeerSnapshot {
  status: string;
  rtcConnId: number;
  hasConnStateHandler: boolean;
  hasIceHandler: boolean;
  restartIceCount: number;
  connClosed: boolean;
  connectionState: string;
  iceConnectionState: string;
  metadata: string;
  joinTimeMs: number;
}

interface ClientState {
  client: ZeroHubClient;
  createdAtConnSeq: number;
  /** `createdSockets` count at client-creation time (baseline). */
  createdAtWsSeq: number;
  /** Status transitions captured by `recordStatusChanges`. */
  statusLog?: Array<{ peerId: string; status: string }>;
  /** `onZeroHubError` messages captured by `recordZeroHubErrors`. */
  zeroHubErrors?: string[];
  /** `onOffer` (peer, offerSdp) captures from `recordOffers`. */
  offers?: Array<{ peerId: string; offerSdp: string }>;
  /** `onAnswer` (peer, answerSdp) captures from `recordAnswers`. */
  answers?: Array<{ peerId: string; answerSdp: string }>;
  /** `logger.warn` messages captured when built via `createClientWithLogger`. */
  warns?: string[];
  /** SDP/ICE sends captured when the socket is stubbed via `stubSocket`. */
  sends?: Array<{
    kind: "offer" | "answer" | "iceCandidate";
    peerId: string;
    sdp?: string;
    candidate?: string;
  }>;
}

const clients = new Map<number, ClientState>();
let nextClientId = 0;

/** Serialisable view of a single peer + its live connection. */
function snapshotPeer(client: ZeroHubClient, peerId: string): PeerSnapshot {
  const peer = client.peers[peerId];
  if (!peer) {
    return {
      status: "__absent__",
      rtcConnId: -1,
      hasConnStateHandler: false,
      hasIceHandler: false,
      restartIceCount: 0,
      connClosed: false,
      connectionState: "",
      iceConnectionState: "",
      metadata: "",
      joinTimeMs: 0,
    };
  }
  const conn = asMock(peer.rtcConn);
  return {
    status: peer.status,
    rtcConnId: conn ? conn.__instanceId : -1,
    hasConnStateHandler: conn ? typeof conn.onconnectionstatechange === "function" : false,
    hasIceHandler: conn ? typeof conn.oniceconnectionstatechange === "function" : false,
    restartIceCount: conn ? conn.__restartIceCount : 0,
    connClosed: conn ? conn.__closed : false,
    connectionState: conn ? conn.connectionState : "",
    iceConnectionState: conn ? conn.iceConnectionState : "",
    metadata: JSON.stringify(peer.metadata),
    joinTimeMs: peer.joinTime.getTime(),
  };
}

const ZeroHubUnitHarness = {
  /** Pure helper under test: return the WS URL for a host + tls flag. */
  wsUrl(host: string, tls: boolean): string {
    return getWS(host, tls);
  },

  /** Create a client with a no-op topology; returns an opaque numeric id. */
  createClient(): number {
    const id = ++nextClientId;
    const client = new ZeroHubClient(
      ["localhost:1"],
      { logLevel: LogLevel.None },
      new NoopTopology()
    );
    clients.set(id, {
      client,
      createdAtConnSeq: createdInstances.length,
      createdAtWsSeq: wsInstances.length,
    });
    return id;
  },

  /**
   * Create a client whose `logger.warn` calls are captured in an in-harness
   * buffer (retrievable via `getWarnings` / `clearWarnings`), so specs can
   * assert exactly which inputs produced the "invalid JSON metadata" warning.
   */
  createClientWithLogger(): number {
    const id = ++nextClientId;
    const warns: string[] = [];
    const client = new ZeroHubClient(
      ["localhost:1"],
      {
        logLevel: LogLevel.Warning,
        logger: {
          log(): void {},
          warn: (message?: unknown) => {
            warns.push(String(message));
          },
          error(): void {},
        },
      },
      new NoopTopology()
    );
    clients.set(id, {
      client,
      createdAtConnSeq: createdInstances.length,
      createdAtWsSeq: wsInstances.length,
      warns,
    });
    return id;
  },

  /** The `logger.warn` messages captured for the client (since creation). */
  getWarnings(id: number): string[] {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    return entry.warns ?? [];
  },

  /**
   * Invoke the client's private `safeParseJson` directly (type cast; private
   * is erased at runtime) with an arbitrary raw string + fallback, so specs
   * can pin the warning contract for edge inputs (e.g. a parsed value equal
   * to a scalar fallback). Returns the JSON-encoded result.
   */
  invokeSafeParse(
    id: number,
    raw: string | undefined,
    fallback: string
  ): string {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    const client = entry.client as unknown as {
      safeParseJson: (raw: string | undefined, fallback: string) => unknown;
    };
    return JSON.stringify(client.safeParseJson(raw, fallback));
  },

  /** Drop the captured `logger.warn` messages for the client. */
  clearWarnings(id: number): void {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    if (entry.warns) {
      entry.warns.length = 0;
    }
  },

  /**
   * Exercises `SFUTopology`'s SFU election directly: builds a client whose
   * topology is a default `SFUTopology`, points `myPeerId` / `peers` at the
   * given IDs, then returns what the topology's `getSFUPeerId()` /
   * `isSFU()` (private, reached via a type cast — erased at bundle time)
   * elect. This avoids needing a real WebSocket / WebRTC connection.
   */
  sfuElection(myPeerId: string, peerIds: string[]): {
    sfuPeerId: string | undefined;
    iAmSFU: boolean;
  } {
    const client = new ZeroHubClient(
      ["localhost:1"],
      { logLevel: LogLevel.None },
      new SFUTopology()
    );
    client.myPeerId = myPeerId;
    const peers: typeof client.peers = {};
    for (const pid of peerIds) {
      if (pid !== myPeerId) {
        peers[pid] = new Peer(
          pid,
          PeerStatus.Pending,
          {},
          new Date(),
          new MockRTCPeerConnection() as unknown as RTCPeerConnection
        );
      }
    }
    client.peers = peers;
    const sfu = client.topology as unknown as SFUTopology;
    return {
      sfuPeerId: (sfu as unknown as { getSFUPeerId(): string | undefined }).getSFUPeerId(),
      iAmSFU: (sfu as unknown as { isSFU(): boolean }).isSFU(),
    };
  },

  /** Feed a `hubInfoMessage` (initial-join path) with the given peer ids. */
  sendHubInfo(id: number, myPeerId: string, peerIds: string[]): void {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    entry.client.handleZeroHubMessage({
      hubInfoMessage: {
        id: "hub-1",
        createTime: new Date(),
        myPeerId,
        hubMetadata: "",
        peers: peerIds.map((pid) => ({
          id: pid,
          metadata: "",
          joinTime: undefined,
        })),
      },
    } as never);
  },

  /** Feed a `peerJoinedMessage` (mid-session-join path) for one peer. */
  sendPeerJoined(id: number, peerId: string): void {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    entry.client.handleZeroHubMessage({
      peerJoinedMessage: {
        peer: { id: peerId, metadata: "", joinTime: undefined },
      },
    } as never);
  },

  /**
   * Feed a `hubInfoMessage` with custom raw metadata strings, capturing
   * whether the dispatcher threw. Regression surface for the P0 crash where a
   * malformed `hubMetadata` (or peer metadata) `JSON.parse`-threw inside
   * `handleZeroHubMessage` and wedged the socket's message loop.
   */
  feedHubInfoWithMetadata(
    id: number,
    myPeerId: string,
    peerIds: string[],
    hubMetadata: string,
    peerMetadata: string
  ): {
    threw: boolean;
    errorMessage: string;
    parsedHubMetadata: string;
    parsedPeerMetadata: string;
  } {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    let threw = false;
    let errorMessage = "";
    try {
      entry.client.handleZeroHubMessage({
        hubInfoMessage: {
          id: "hub-1",
          createTime: new Date(),
          myPeerId,
          hubMetadata,
          peers: peerIds.map((pid) => ({
            id: pid,
            metadata: peerMetadata,
            joinTime: undefined,
          })),
        },
      } as never);
    } catch (err) {
      threw = true;
      errorMessage = err instanceof Error ? err.message : String(err);
    }
    const firstPeer = peerIds[0];
    return {
      threw,
      errorMessage,
      parsedHubMetadata: JSON.stringify(
        entry.client.hubInfo?.metadata ?? null
      ),
      parsedPeerMetadata: firstPeer
        ? JSON.stringify(entry.client.peers[firstPeer]?.metadata ?? null)
        : "null",
    };
  },

  /**
   * Feed a `peerJoinedMessage` with a custom raw peer-metadata string,
   * capturing whether the dispatcher threw.
   */
  feedPeerJoinedWithMetadata(
    id: number,
    peerId: string,
    peerMetadata: string
  ): {
    threw: boolean;
    errorMessage: string;
    parsedPeerMetadata: string | null;
    peerStatus: string | null;
  } {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    let threw = false;
    let errorMessage = "";
    try {
      entry.client.handleZeroHubMessage({
        peerJoinedMessage: {
          peer: { id: peerId, metadata: peerMetadata, joinTime: undefined },
        },
      } as never);
    } catch (err) {
      threw = true;
      errorMessage = err instanceof Error ? err.message : String(err);
    }
    const peer = entry.client.peers[peerId];
    return {
      threw,
      errorMessage,
      parsedPeerMetadata: peer ? JSON.stringify(peer.metadata) : null,
      peerStatus: peer ? peer.status : null,
    };
  },

  /**
   * Poison-then-recover drill: feed a malformed `hubInfoMessage` (the
   * dispatcher-crash vector), then a valid `peerJoinedMessage`, and report
   * whether the dispatcher survived AND still processed the follow-up. This is
   * the end-to-end proof that a bad payload no longer wedges the socket.
   */
  survivesPoisonedHubInfo(
    id: number,
    myPeerId: string,
    followUpPeerId: string
  ): {
    firstThrew: boolean;
    followUpThrew: boolean;
    peerRegistered: boolean;
  } {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    let firstThrew = false;
    try {
      entry.client.handleZeroHubMessage({
        hubInfoMessage: {
          id: "hub-1",
          createTime: new Date(),
          myPeerId,
          hubMetadata: "not-json",
          peers: [],
        },
      } as never);
    } catch {
      firstThrew = true;
    }
    let followUpThrew = false;
    try {
      entry.client.handleZeroHubMessage({
        peerJoinedMessage: {
          peer: {
            id: followUpPeerId,
            metadata: "",
            joinTime: undefined,
          },
        },
      } as never);
    } catch {
      followUpThrew = true;
    }
    return {
      firstThrew,
      followUpThrew,
      peerRegistered: followUpPeerId in entry.client.peers,
    };
  },

  /** Simulate a connection-state change on a peer's live connection. */
  setConnectionState(id: number, peerId: string, state: string): PeerSnapshot {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    const conn = asMock(entry.client.peers[peerId]?.rtcConn);
    if (!conn) {
      throw new Error(`no peer ${peerId} on client ${id}`);
    }
    conn.connectionState = state;
    if (conn.onconnectionstatechange) {
      conn.onconnectionstatechange({} as Event);
    }
    return snapshotPeer(entry.client, peerId);
  },

  /** Simulate an ICE-state change on a peer's live connection. */
  setIceState(id: number, peerId: string, state: string): PeerSnapshot {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    const conn = asMock(entry.client.peers[peerId]?.rtcConn);
    if (!conn) {
      throw new Error(`no peer ${peerId} on client ${id}`);
    }
    conn.iceConnectionState = state;
    if (conn.oniceconnectionstatechange) {
      conn.oniceconnectionstatechange({} as Event);
    }
    return snapshotPeer(entry.client, peerId);
  },

  /** Snapshot a single peer (or `__absent__` markers if not present). */
  getPeer(id: number, peerId: string): PeerSnapshot {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    return snapshotPeer(entry.client, peerId);
  },

  /** The IDs of the peers currently in the client's `peers` map. */
  peerIds(id: number): string[] {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    return Object.keys(entry.client.peers);
  },

  /**
   * Snapshot a mock connection by its instance id (from `PeerSnapshot.rtcConnId`),
   * still valid after the owning peer has been removed from the map — lets
   * specs assert a pruned peer's `RTCPeerConnection` was closed and its
   * handlers nulled.
   */
  getConnection(id: number, connId: number): {
    closed: boolean;
    hasConnStateHandler: boolean;
    hasIceHandler: boolean;
  } {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    const conn = createdInstances.find((c) => c.__instanceId === connId);
    if (!conn) {
      return { closed: false, hasConnStateHandler: false, hasIceHandler: false };
    }
    return {
      closed: conn.__closed,
      hasConnStateHandler: typeof conn.onconnectionstatechange === "function",
      hasIceHandler: typeof conn.oniceconnectionstatechange === "function",
    };
  },

  /**
   * Starts recording `onPeerStatusChange` callbacks on the client so specs
   * can assert which status transitions the reconcile pass emitted.
   */
  recordStatusChanges(id: number): void {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    entry.statusLog = [];
    entry.client.onPeerStatusChange = (peer) => {
      entry.statusLog?.push({ peerId: peer.id, status: peer.status });
    };
  },

  /** Returns and clears the status transitions recorded by `recordStatusChanges`. */
  drainStatusChanges(
    id: number
  ): Array<{ peerId: string; status: string }> {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    const log = entry.statusLog ?? [];
    entry.statusLog = [];
    return log;
  },

  /** The client's current `myPeerId` (or null if unset). */
  getMyPeerId(id: number): string | null {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    return entry.client.myPeerId ?? null;
  },

  /** Number of mock RTCPeerConnection instances created for this client. */
  connectionsCreated(id: number): number {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    return createdInstances.length - entry.createdAtConnSeq;
  },

  /**
   * Installs a capturing WebSocket stub on `client.ws` so `sendOffer` /
   * `sendAnswer` pass their "connected" guard without a real socket. Each
   * encoded `ClientMessage` sent over the stub is decoded and recorded in the
   * per-client `sends` buffer (retrievable via `getSends` / `drainSends`),
   * letting specs assert the SDP was sent exactly once and via which path.
   */
  stubSocket(id: number): void {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    if (!entry.sends) {
      entry.sends = [];
    }
    entry.client.ws = {
      close() {},
      send(data: unknown) {
        const msg = ClientMessage.decode(data as Uint8Array);
        if (msg.sendOfferMessage) {
          entry.sends?.push({
            kind: "offer",
            peerId: msg.sendOfferMessage.answerPeerId,
            sdp: msg.sendOfferMessage.offerSdp,
          });
        }
        if (msg.sendAnswerMessage) {
          entry.sends?.push({
            kind: "answer",
            peerId: msg.sendAnswerMessage.offerPeerId,
            sdp: msg.sendAnswerMessage.answerSdp,
          });
        }
        if (msg.sendIceCandidateMessage) {
          entry.sends?.push({
            kind: "iceCandidate",
            peerId: msg.sendIceCandidateMessage.peerId,
            candidate: msg.sendIceCandidateMessage.candidate,
          });
        }
      },
    } as unknown as WebSocket;
  },

  /**
   * Sets the client's `config.waitIceCandidatesTimeout` to a custom value so
   * specs can drive the ICE-candidate fallback timer on a short, controllable
   * delay instead of the 2000ms default.
   */
  setWaitIceTimeout(id: number, ms: number): void {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    entry.client.config.waitIceCandidatesTimeout = ms;
  },

  /**
   * Fires the peer's `onicecandidate` handler with a given candidate value,
   * simulating an ICE event from the mock `RTCPeerConnection`. Passing a
   * truthy candidate models an in-flight candidate (the first one also fires
   * the SDP send; every candidate-bearing event is trickled to the remote
   * peer); passing `null` models the "gathering complete" marker, which fires
   * the SDP send if it has not gone out yet.
   */
  fireIceCandidate(id: number, peerId: string, candidate: unknown): void {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    const conn = asMock(entry.client.peers[peerId]?.rtcConn);
    if (!conn) {
      throw new Error(`no peer ${peerId} on client ${id}`);
    }
    if (conn.onicecandidate) {
      conn.onicecandidate({ candidate });
    }
  },

  /** The SDP/ICE sends captured for this client (since `stubSocket`). */
  getSends(
    id: number
  ): Array<{
    kind: "offer" | "answer" | "iceCandidate";
    peerId: string;
    sdp?: string;
    candidate?: string;
  }> {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    return entry.sends ?? [];
  },

  /** Returns and clears the captured SDP/ICE sends for this client. */
  drainSends(
    id: number
  ): Array<{
    kind: "offer" | "answer" | "iceCandidate";
    peerId: string;
    sdp?: string;
    candidate?: string;
  }> {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    const sends = entry.sends ?? [];
    entry.sends = [];
    return sends;
  },

  /**
   * Drives the public `createHub` entry point (opens a socket via
   * `connectToZeroHub`) so specs can exercise the real connection path
   * without a server.
   */
  createHub(
    id: number,
    hubId: string,
    peerMetadata?: object,
    hubMetadata?: object
  ): void {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    entry.client.createHub(hubId, peerMetadata, hubMetadata);
  },

  /**
   * Drives the public `joinHub` entry point (opens a socket via
   * `connectToZeroHub`) so specs can exercise the real connection path
   * without a server.
   */
  joinHub(id: number, hubId: string, peerMetadata?: object): void {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    entry.client.joinHub(hubId, peerMetadata);
  },

  /**
   * Drives the public `joinPermanentHub` entry point (opens a socket via
   * `connectToZeroHub`) so specs can exercise the real connection path
   * without a server.
   */
  joinPermanentHub(id: number, hubId: string, peerMetadata?: object): void {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    entry.client.joinPermanentHub(hubId, peerMetadata);
  },

  /** Drives the public `disconnect()` on the client. */
  disconnectClient(id: number): void {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    entry.client.disconnect();
  },

  /**
   * Snapshot every mock `WebSocket` the harness created, with the subset that
   * still has a live handler slot. Lets specs assert no orphaned live socket
   * survives a connection replacement.
   */
  snapshotSockets(id: number): Array<{
    instanceId: number;
    url: string;
    closed: boolean;
    closeCodes: number[];
    hasMessageHandler: boolean;
    hasErrorHandler: boolean;
    hasCloseHandler: boolean;
    hasOpenHandler: boolean;
  }> {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    return wsInstances
      .filter((ws) => ws.__instanceId > entry.createdAtWsSeq)
      .map((ws) => ({
        instanceId: ws.__instanceId,
        url: ws.url,
        closed: ws.__closed,
        closeCodes: [...ws.__closeCalls],
        hasMessageHandler: typeof ws.onmessage === "function",
        hasErrorHandler: typeof ws.onerror === "function",
        hasCloseHandler: typeof ws.onclose === "function",
        hasOpenHandler: typeof ws.onopen === "function",
      }));
  },

  /** The `hostIndex` of the client (read-only accessor over a public field;
   * exposed so specs can assert a replaced socket did not double-advance it). */
  getHostIndex(id: number): number {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    return entry.client.hostIndex;
  },

  /** Create a client with an explicit host list; returns an opaque id. */
  createClientWithHosts(hosts: string[]): number {
    const id = ++nextClientId;
    const client = new ZeroHubClient(
      hosts,
      { logLevel: LogLevel.None },
      new NoopTopology()
    );
    clients.set(id, {
      client,
      createdAtConnSeq: createdInstances.length,
      createdAtWsSeq: wsInstances.length,
    });
    return id;
  },

  /**
   * The client's current `host` (public field; exposed so the migration
   * redirect spec can assert `reconnect()` updated the state, not just the
   * URL it was passed).
   */
  getHost(id: number): string {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    return entry.client.host;
  },

  /**
   * Replaces the live socket's `send` with a decoder that records encoded
   * `ClientMessage`s in the per-client `sends` buffer (the same buffer
   * `getSends` / `drainSends` read). Use AFTER a reconnect has replaced
   * `client.ws` with a fresh `MockWebSocket`, when `stubSocket`'s capture
   * no longer wraps the live socket. No-op if the live socket is not a
   * `MockWebSocket` (e.g. already a capturing stub).
   */
  captureSocket(id: number): void {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    if (!entry.sends) {
      entry.sends = [];
    }
    const ws = entry.client.ws as unknown as MockWebSocket | undefined;
    if (!ws || typeof ws.send !== "function") {
      throw new Error(`client ${id} has no live socket to capture`);
    }
    ws.send = function (data: unknown) {
      const msg = ClientMessage.decode(data as Uint8Array);
      if (msg.sendOfferMessage) {
        entry.sends?.push({
          kind: "offer",
          peerId: msg.sendOfferMessage.answerPeerId,
          sdp: msg.sendOfferMessage.offerSdp,
        });
      }
      if (msg.sendAnswerMessage) {
        entry.sends?.push({
          kind: "answer",
          peerId: msg.sendAnswerMessage.offerPeerId,
          sdp: msg.sendAnswerMessage.answerSdp,
        });
      }
      if (msg.sendIceCandidateMessage) {
        entry.sends?.push({
          kind: "iceCandidate",
          peerId: msg.sendIceCandidateMessage.peerId,
          candidate: msg.sendIceCandidateMessage.candidate,
        });
      }
    };
  },

  /**
   * Number of mock `WebSocket` instances this client opened since creation
   * (each `connectToZeroHub` call opens exactly one) — lets specs assert a
   * reconnect actually dialed a new socket.
   */
  getSocketCount(id: number): number {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    return wsInstances.filter((ws) => ws.__instanceId > entry.createdAtWsSeq)
      .length;
  },

  /** The URL string of the most recently created mock socket for this
   * client, or null if the client opened none yet.
   */
  getLastSocketUrl(id: number): string | null {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    const mine = wsInstances.filter((ws) => ws.__instanceId > entry.createdAtWsSeq);
    return mine.length > 0 ? mine[mine.length - 1].url : null;
  },

  /**
   * Simulate the server's migration close (`ForwardMigrate`): fire the live
   * socket's `onclose` with code 1001 and the redirect host as the close
   * reason. The client's onclose handler calls `reconnect(url, reason)`
   * synchronously, so after this returns the redirected socket exists.
   */
  simulateMigrationClose(id: number, reason: string): void {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    const ws = entry.client.ws as unknown as MockWebSocket;
    if (!ws?.onclose) {
      throw new Error(`client ${id} has no live socket with a close handler`);
    }
    ws.onclose({ code: 1001, reason });
  },

  /**
   * Simulate an abnormal network close (code 1006, empty reason) on the
   * live socket — the automatic host-failover path of `reconnect(url)` with
   * no redirect host.
   */
  simulateAbnormalClose(id: number): void {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    const ws = entry.client.ws as unknown as MockWebSocket;
    if (!ws?.onclose) {
      throw new Error(`client ${id} has no live socket with a close handler`);
    }
    ws.onclose({ code: 1006, reason: "" });
  },

  /**
   * Drives `client.sendOffer(peerId, options)` end-to-end (mock
   * RTCPeerConnection) and returns the shared config options plus the options
   * the mock connection actually received, so specs can assert the merge
   * neither mutated the shared config nor lost a key the config set.
   */
  async invokeSendOffer(
    id: number,
    peerId: string,
    options?: { offerToReceiveAudio?: boolean; offerToReceiveVideo?: boolean }
  ): Promise<{ configOptions: string; sentOptions: string }> {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    await entry.client.sendOffer(peerId, options ?? {});
    const conn = asMock(entry.client.peers[peerId]?.rtcConn);
    return {
      configOptions: JSON.stringify(entry.client.config.rtcOfferOptions),
      sentOptions: JSON.stringify(conn?.__lastCreateOfferOptions ?? null),
    };
  },

  /** `invokeSendOffer` twin for `client.sendAnswer`. */
  async invokeSendAnswer(
    id: number,
    peerId: string,
    offerSdp: string,
    options?: { offerToReceiveAudio?: boolean; offerToReceiveVideo?: boolean }
  ): Promise<{ configOptions: string; sentOptions: string }> {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    await entry.client.sendAnswer(peerId, offerSdp, options ?? {});
    const conn = asMock(entry.client.peers[peerId]?.rtcConn);
    return {
      configOptions: JSON.stringify(entry.client.config.rtcOfferOptions),
      sentOptions: JSON.stringify(conn?.__lastCreateAnswerOptions ?? null),
    };
  },

  /** Instance ids of the connections currently referenced by this client. */
  referencedConnectionIds(id: number): number[] {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    return Object.values(entry.client.peers)
      .map((peer) => asMock(peer.rtcConn))
      .filter((conn): conn is MockRTCPeerConnection => conn !== undefined)
      .map((conn) => conn.__instanceId);
  },

  /**
   * Starts capturing `onZeroHubError` callbacks on the client so specs can
   * assert that terminal reconnect failures surfaced to the application
   * (e.g. the self-redirect guard in `reconnect()`).
   */
  recordZeroHubErrors(id: number): void {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    entry.zeroHubErrors = [];
    entry.client.onZeroHubError = (error) => {
      entry.zeroHubErrors?.push(error.message);
    };
  },

  /** The `onZeroHubError` messages captured by `recordZeroHubErrors`. */
  getZeroHubErrors(id: number): string[] {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    return entry.zeroHubErrors ?? [];
  },

  /**
   * Triggers a terminal reconnect failure: the client's single host is
   * already the last one, so `reconnect()` exhausts the host list and its
   * rejection must surface through `onZeroHubError`. Returns the captured
   * error messages after the promise rejection has settled.
   */
  async triggerAllHostsExhausted(id: number): Promise<string[]> {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    const log: string[] = [];
    entry.client.onZeroHubError = (error) => {
      log.push(error.message);
    };
    entry.client.reconnect(new URL("ws://localhost:1"));
    // The `getZeroHubBackupHost()` rejection flows through the
    // `.then().catch()` chain in microtasks; flush them before reading.
    for (let i = 0; i < 5; i += 1) {
      await Promise.resolve();
    }
    return log;
  },

  /**
   * Flips the client's `config.autoAnswer` flag so specs can exercise the
   * manual-offer-handling path of the `offerMessage` branch.
   */
  setAutoAnswer(id: number, autoAnswer: boolean): void {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    entry.client.config.autoAnswer = autoAnswer;
  },

  /**
   * Starts capturing `onOffer` callbacks on the client so specs can assert the
   * incoming offer SDP is surfaced when `autoAnswer` is `false`.
   */
  recordOffers(id: number): void {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    entry.offers = [];
    entry.client.onOffer = (peer, offerSdp) => {
      entry.offers?.push({ peerId: peer.id, offerSdp });
    };
  },

  /** The `(peerId, offerSdp)` pairs captured by `recordOffers`. */
  getOffers(id: number): Array<{ peerId: string; offerSdp: string }> {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    return entry.offers ?? [];
  },

  /**
   * Flips the client's `config.autoAcceptAnswer` flag so specs can exercise
   * the manual-answer-handling path of the `answerMessage` branch.
   */
  setAutoAcceptAnswer(id: number, autoAcceptAnswer: boolean): void {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    entry.client.config.autoAcceptAnswer = autoAcceptAnswer;
  },

  /**
   * Starts capturing `onAnswer` callbacks on the client so specs can assert
   * the incoming answer SDP is surfaced when `autoAcceptAnswer` is `false`.
   */
  recordAnswers(id: number): void {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    entry.answers = [];
    entry.client.onAnswer = (peer, answerSdp) => {
      entry.answers?.push({ peerId: peer.id, answerSdp });
    };
  },

  /** The `(peerId, answerSdp)` pairs captured by `recordAnswers`. */
  getAnswers(id: number): Array<{ peerId: string; answerSdp: string }> {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    return entry.answers ?? [];
  },

  /**
   * Feeds an `answerMessage` (an incoming answer from a remote peer) into
   * the client's dispatcher, so specs can drive the answer-accept path
   * without a server.
   */
  sendAnswerMessage(id: number, answerPeerId: string, answerSdp: string): void {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    entry.client.handleZeroHubMessage({
      answerMessage: { answerPeerId, answerSdp },
    } as never);
  },

  /**
   * Drives the public `acceptAnswer(peerId, answerSdp)` entry point and
   * reports whether it resolved. The underlying `setRemoteDescription` call
   * (type "answer", the exact SDP) is recorded on the mock connection and
   * readable via `getRemoteDescriptions`.
   */
  async invokeAcceptAnswer(
    id: number,
    peerId: string,
    answerSdp: string
  ): Promise<void> {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    await entry.client.acceptAnswer(peerId, answerSdp);
  },

  /**
   * The `setRemoteDescription` calls made on this client's peer connections
   * (type + sdp), in call order — lets specs assert which SDPs were applied
   * to which peer and that `acceptAnswer`/`sendAnswer` actually consumed the
   * right one.
   */
  getRemoteDescriptions(
    id: number
  ): Array<{ peerId: string; type: string; sdp: string }> {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    const calls: Array<{ peerId: string; type: string; sdp: string }> = [];
    for (const [peerId, peer] of Object.entries(entry.client.peers)) {
      const conn = asMock(peer.rtcConn);
      for (const desc of conn?.__remoteDescriptions ?? []) {
        calls.push({ peerId, type: desc.type, sdp: desc.sdp });
      }
    }
    return calls;
  },

  /**
   * Feeds an `offerMessage` (an incoming offer from a remote peer) into the
   * client's dispatcher, so specs can drive the offer/answer path without a
   * server.
   */
  sendOfferMessage(id: number, offerPeerId: string, offerSdp: string): void {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    entry.client.handleZeroHubMessage({
      offerMessage: { offerPeerId, offerSdp },
    } as never);
  },

  /** The status string of a single peer (or `null` if absent). */
  getPeerStatus(id: number, peerId: string): string | null {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    const peer = entry.client.peers[peerId];
    return peer ? peer.status : null;
  },

  /**
   * Feeds an `iceCandidateMessage` (an incoming trickled ICE candidate from a
   * remote peer) into the client's dispatcher, so specs can drive the
   * `addIceCandidate` path without a server.
   */
  sendIceCandidateMessage(id: number, peerId: string, candidate: string): void {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    entry.client.handleZeroHubMessage({
      iceCandidateMessage: { peerId, candidate },
    } as never);
  },

  /**
   * The `addIceCandidate` arguments applied to a peer's `RTCPeerConnection`,
   * as serialized strings, in call order — lets specs assert an incoming
   * trickled candidate actually reached the target peer's connection.
   */
  getAddedIceCandidates(id: number, peerId: string): string[] {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    const conn = asMock(entry.client.peers[peerId]?.rtcConn);
    return conn?.__addedIceCandidates ?? [];
  },
};

declare global {
  interface Window {
    ZeroHubUnitHarness: typeof ZeroHubUnitHarness;
  }
}

window.ZeroHubUnitHarness = ZeroHubUnitHarness;

export {};

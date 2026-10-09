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
import { ZeroHubClient, LogLevel, Topology } from "../../client/src/index";
import { getWS } from "../../client/src/utils";

let instanceSeq = 0;
const createdInstances: MockRTCPeerConnection[] = [];

/** Cast a client connection to the mock we installed. */
function asMock(
  conn: RTCPeerConnection | undefined | null
): MockRTCPeerConnection | undefined {
  return conn as unknown as MockRTCPeerConnection | undefined;
}

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

  createOffer(options?: RTCOfferOptions): Promise<{ type: string; sdp: string }> {
    this.__lastCreateOfferOptions = options ?? null;
    return Promise.resolve({ type: "offer", sdp: "" });
  }

  createAnswer(options?: RTCOfferOptions): Promise<{ type: string; sdp: string }> {
    this.__lastCreateAnswerOptions = options ?? null;
    return Promise.resolve({ type: "answer", sdp: "" });
  }

  setLocalDescription(): Promise<void> {
    return Promise.resolve();
  }

  setRemoteDescription(): Promise<void> {
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
    clients.set(id, { client, createdAtConnSeq: createdInstances.length });
    return id;
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

  /** Number of mock RTCPeerConnection instances created for this client. */
  connectionsCreated(id: number): number {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    return createdInstances.length - entry.createdAtConnSeq;
  },

  /**
   * Installs a minimal WebSocket stub on `client.ws` so `sendOffer` /
   * `sendAnswer` pass their "connected" guard without a real socket.
   */
  stubSocket(id: number): void {
    const entry = clients.get(id);
    if (!entry) {
      throw new Error(`no client ${id}`);
    }
    entry.client.ws = { close() {}, send() {} } as unknown as WebSocket;
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
};

declare global {
  interface Window {
    ZeroHubUnitHarness: typeof ZeroHubUnitHarness;
  }
}

window.ZeroHubUnitHarness = ZeroHubUnitHarness;

export {};

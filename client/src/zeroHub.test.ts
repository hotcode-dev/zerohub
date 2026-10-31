import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as crypto from "node:crypto";
import * as http from "node:http";
import type { Duplex } from "node:stream";
import { Config, LogLevel, PeerStatus } from "./types";
import { ZeroHubLogger } from "./logger";
import { Peer } from "./peer";
import { ServerMessage } from "./proto/zerohub/v1/server_message";
import { ZeroHubClient } from "./zeroHub";
import { setupDataChannel, setupMediaChannel } from "./topology/peerSetup";

/**
 * Focused unit tests for the highest-risk signalling/reconnect logic in
 * `zeroHub.ts`. Everything runs under Node, so `RTCPeerConnection` and
 * topology side-effects are replaced with minimal fakes.
 */

class FakeLogger {
  public log = vi.fn();
  public warn = vi.fn();
  public error = vi.fn();
}

class FakeTopology {
  public zeroHub: ZeroHubClient | undefined = undefined;
  public onPeerStatusChange = vi.fn();
  public init(zeroHub: ZeroHubClient) {
    this.zeroHub = zeroHub;
  }
}

class FakeRTCPeerConnection {
  public localDescription: RTCSessionDescription | null = null;
  public closeCalls = 0;
  public onconnectionstatechange: ((ev: unknown) => void) | null = null;
  public oniceconnectionstatechange: ((ev: unknown) => void) | null = null;
  public onicecandidate: ((ev: { candidate?: object | null }) => void) | null =
    null;
  public ondatachannel:
    | ((ev: { channel?: { label: string } | null }) => void)
    | null = null;
  public ontrack: ((ev: { streams?: MediaStream[] }) => void) | null = null;
  public connectionState = "new";
  public iceConnectionState = "new";

  close() {
    this.closeCalls += 1;
  }

  restartIce() {
    /* no-op */
  }

  setConfiguration(_config: RTCConfiguration) {
    /* no-op */
  }

  createOffer(_options?: RTCOfferOptions): Promise<RTCSessionDescription> {
    return Promise.reject(new Error("createOffer not implemented in fake"));
  }

  setRemoteDescription(_description: RTCSessionDescriptionInit): Promise<void> {
    return Promise.reject(
      new Error("setRemoteDescription not implemented in fake")
    );
  }

  setLocalDescription(_description: RTCSessionDescriptionInit): Promise<void> {
    return Promise.resolve();
  }

  createAnswer(_options?: RTCOfferOptions): Promise<RTCSessionDescription> {
    return Promise.reject(new Error("createAnswer not implemented in fake"));
  }
}

/** Build a `Peer` wrapped around a fake `RTCPeerConnection`. */
function makePeer(id: string): { peer: Peer; rtc: FakeRTCPeerConnection } {
  const rtc = new FakeRTCPeerConnection();
  const peer = new Peer(
    id,
    PeerStatus.Pending,
    {},
    new Date(),
    rtc as unknown as RTCPeerConnection
  );
  return { peer, rtc };
}

/**
 * Construct a real `ZeroHubClient` with a fake logger and fake topology, so
 * we can inspect / spy on the public state (`peers`, `host`, `hostIndex`).
 */
function makeClient(hosts: string[] = ["first-host"]): ZeroHubClient {
  const client = new ZeroHubClient(hosts, { logLevel: LogLevel.Warning });
  client.logger = new FakeLogger() as unknown as ZeroHubLogger;
  client.topology = new FakeTopology() as unknown as ZeroHubClient["topology"];
  client.topology.init(client);
  return client;
}

/**
 * Stub `connectToZeroHub` to just record the URL it was called with, so the
 * reconnect tests don't actually open a WebSocket. Mirrors the real method's
 * `reconnectAbandoned` reset: a fresh entry-point dial is the only thing that
 * may start a new session after the terminal error fired.
 */
function stubConnectToZeroHub(client: ZeroHubClient) {
  const calls: URL[] = [];
  client.connectToZeroHub = (url: URL) => {
    calls.push(url);
    // Mirror the real method: a fresh entry-point dial clears the
    // "abandoned" latch (the terminal sweep budget is spent) so the client
    // can start a new session.
    (client as unknown as { reconnectAbandoned: boolean }).reconnectAbandoned =
      false;
    // The real method returns the connect Promise; the stub dials nowhere,
    // so it reports a successful (no-op) connect.
    return Promise.resolve();
  };
  return calls;
}

/** Read the private `reconnectAttempts` counter (private is erased at runtime). */
function attempts(client: ZeroHubClient): number {
  return (client as unknown as { reconnectAttempts: number }).reconnectAttempts;
}

/**
 * Mark the client as past its initial connection (an established session), so
 * `reconnect()` exercises the same-host retry / wraparound branch instead of
 * the initial-connection fast-failover branch. `reconnect()` only retries the
 * SAME host once a connection has been confirmed (the first `onopen` fires);
 * the initial dial fails over immediately so a dead first host does not burn
 * its whole backoff budget before failover. These tests model an abnormal
 * close on an ESTABLISHED connection, so they flip this flag.
 */
function markEstablished(client: ZeroHubClient) {
  (client as unknown as { isInitialConnection: boolean }).isInitialConnection =
    false;
}

// `addPeer` constructs a real `RTCPeerConnection`; stub the global so it
// resolves to the fake under Node.
beforeAll(() => {
  vi.stubGlobal("RTCPeerConnection", class extends FakeRTCPeerConnection {});
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("hub entry points — awaitable connect contract", () => {
  // These entry points return a Promise that resolves when the signaling
  // WebSocket opens and rejects when the connection attempt fails (the
  // hub join itself — myPeerId/peers — is still signalled via onHubInfo).
  // The tests run against a REAL local WebSocket server so the returned
  // Promise can be observed resolving; a rejecting dial is covered by the
  // "connectToZeroHub — connect Promise settles once" suite below.
  const HUB_ENTRY_POINTS: [
    string,
    (client: ZeroHubClient) => Promise<void>,
    string,
  ][] = [
    [
      "createHub",
      (c) => c.createHub("h", { p: 1 }, { m: 1 }),
      "/v1/hubs/create",
    ],
    ["joinHub", (c) => c.joinHub("h", { p: 1 }), "/v1/hubs/join"],
    [
      "joinPermanentHub",
      (c) => c.joinPermanentHub("h", { p: 1 }),
      "/v1/permanent-hubs/join",
    ],
    [
      "joinOrCreateHub",
      (c) => c.joinOrCreateHub("h", { p: 1 }, { m: 1 }),
      "/v1/hubs/join-or-create",
    ],
    [
      "joinOrCreateIPHub",
      (c) => c.joinOrCreateIPHub({ p: 1 }, { m: 1 }),
      "/v1/ip-hubs/join-or-create",
    ],
    [
      "createRandomHub",
      (c) => c.createRandomHub({ p: 1 }, { m: 1 }),
      "/v1/random-hubs/create",
    ],
    [
      "joinRandomHub",
      (c) => c.joinRandomHub("h", { p: 1 }),
      "/v1/random-hubs/join",
    ],
  ];

  let server: import("node:http").Server;
  let wsPort: number;
  let connectCalls: URL[];

  /**
   * Track every upgraded socket so `afterEach` can close them cleanly.
   */
  let sockets: Set<Duplex> = new Set();

  beforeEach(async () => {
    server = http.createServer();
    server.on("upgrade", (req, socket) => {
      // Complete the RFC 6455 upgrade handshake: write the 101 with the
      // accept key (base64(SHA1(key + GUID))). The client's global
      // WebSocket then fires `open` — which is what the entry-point
      // Promise resolves on. The socket must stay open after the 101.
      const key = req.headers["sec-websocket-key"];
      if (!key) {
        socket.destroy();
        return;
      }
      const accept = crypto
        .createHash("sha1")
        .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
        .digest("base64");
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\n` +
          `Upgrade: websocket\r\n` +
          `Connection: Upgrade\r\n` +
          `Sec-WebSocket-Accept: ${accept}\r\n` +
          `\r\n`
      );
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve())
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("test WebSocket server did not bind to a port");
    }
    wsPort = address.port;
    connectCalls = [];
  });

  afterEach(async () => {
    // Close any still-open socket (a test that disconnected the client
    // early leaves none, but the entry-point tests close the hub socket
    // with a 1000 close frame the server must drain).
    sockets.forEach((socket) => {
      socket.destroy();
    });
    sockets = new Set();
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  });

  it.each(HUB_ENTRY_POINTS)(
    "%s returns a Promise that resolves on socket open and dials the expected endpoint",
    async (_name, invoke, expectedPath) => {
      const client = makeClient([`127.0.0.1:${wsPort}`]);
      client.config.tls = false;
      const original = client.connectToZeroHub.bind(client);
      client.connectToZeroHub = (url: URL) => {
        connectCalls.push(url);
        return original(url);
      };

      const promise = invoke(client);

      // The call returns a live Promise (not void) that is still pending…
      expect(promise).toBeInstanceOf(Promise);
      // …and the connection is initiated synchronously by the call itself.
      expect(connectCalls).toHaveLength(1);
      expect(connectCalls[0].pathname).toBe(expectedPath);

      await promise;
      // The Promise resolved on the WebSocket open, and the socket is live.
      expect(client.ws?.readyState).toBe(WebSocket.OPEN);

      client.disconnect();
      await new Promise((r) => setTimeout(r, 20));
    }
  );
});

describe("connectToZeroHub — connect Promise settles once", () => {
  // Drives the REAL connectToZeroHub (no stub): a local WebSocket server
  // completes the handshake (open); the fake-dial case (port 9) fails with
  // an immediate error/close pair.
  let server: import("node:http").Server;
  let wsPort: number;
  let sockets: Set<Duplex> = new Set();

  beforeEach(async () => {
    server = http.createServer();
    server.on("upgrade", (req, socket) => {
      // Complete the RFC 6455 upgrade handshake: write the 101 with the
      // accept key (base64(SHA1(key + GUID))). The client's global
      // WebSocket then fires `open`. The socket must stay open after the
      // 101 (a close() on it would surface as an unexpected 1006).
      const key = req.headers["sec-websocket-key"];
      if (!key) {
        socket.destroy();
        return;
      }
      const accept = crypto
        .createHash("sha1")
        .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
        .digest("base64");
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\n` +
          `Upgrade: websocket\r\n` +
          `Connection: Upgrade\r\n` +
          `Sec-WebSocket-Accept: ${accept}\r\n` +
          `\r\n`
      );
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve())
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("test WebSocket server did not bind to a port");
    }
    wsPort = address.port;
  });

  afterEach(async () => {
    sockets.forEach((socket) => {
      socket.destroy();
    });
    sockets = new Set();
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  });

  /**
   * Fire the client socket's `onclose` handler with a scriptable close
   * code. The handshake completes and `onopen` fires first (resolving the
   * Promise), so by the time a close lands the one-shot `settle` guard is
   * already consumed: this exercises that a late close cannot re-settle the
   * Promise, and — for the reconnection codes — the `reconnect()` dispatch.
   */
  function fakeClose(code: number, reason = "") {
    (
      client.ws as unknown as {
        onclose: (ev: { code: number; reason: string }) => void;
      }
    ).onclose({
      code,
      reason,
    });
  }

  let client: ZeroHubClient;
  let reconnectSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = makeClient([`127.0.0.1:${wsPort}`]);
    client.config.tls = false;
    reconnectSpy = vi.fn();
    client.reconnect = reconnectSpy as never;
  });

  it("resolves on open", async () => {
    const promise = client.connectToZeroHub(
      new URL(`ws://127.0.0.1:${wsPort}/v1/hubs/join?id=h`)
    );
    expect(promise).toBeInstanceOf(Promise);
    await promise;
    expect(client.ws?.readyState).toBe(WebSocket.OPEN);
    client.disconnect();
    await new Promise((r) => setTimeout(r, 20));
  });

  it("rejects on error, and the follow-up close (1006) cannot double-settle", async () => {
    // Port 9 (discard) is guaranteed to refuse the connection: the global
    // WebSocket fires `error` and then `close` (1006) for the aborted dial.
    const promise = client.connectToZeroHub(
      new URL("ws://127.0.0.1:9/v1/hubs/join?id=h")
    );
    let rejected: Error | undefined;
    const outcome = await promise.then(
      () => "resolved" as const,
      (err: Error) => {
        rejected = err;
        return "rejected" as const;
      }
    );
    expect(outcome).toBe("rejected");
    expect(rejected).toBeInstanceOf(Error);
    expect(rejected?.message).toContain("ZeroHub WebSocket error");
    // The one-shot settle guard means the Promise already settled; the
    // follow-up `close` (1006) took the reconnect path, not a second settle.
    expect(reconnectSpy).toHaveBeenCalledTimes(1);
  });

  it("a protocol-level close code after open surfaces onZeroHubError without re-settling", async () => {
    const promise = client.connectToZeroHub(
      new URL(`ws://127.0.0.1:${wsPort}/v1/hubs/join?id=h`)
    );
    await promise; // open resolved it

    const errors: Error[] = [];
    client.onZeroHubError = (e) => errors.push(e);
    fakeClose(1002);
    // The default branch fires onZeroHubError; the Promise itself is
    // already settled (open consumed the one-shot guard).
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("1002");
    client.disconnect();
    await new Promise((r) => setTimeout(r, 20));
  });

  it("routes 1001/1006/1011 closes to reconnect, not to the Promise", async () => {
    const promise = client.connectToZeroHub(
      new URL(`ws://127.0.0.1:${wsPort}/v1/hubs/join?id=h`)
    );
    await promise;

    fakeClose(1001, "other-host");
    expect(reconnectSpy).toHaveBeenCalledTimes(1);
    expect(reconnectSpy.mock.calls[0][1]).toBe("other-host");

    fakeClose(1006);
    expect(reconnectSpy).toHaveBeenCalledTimes(2);
    expect(reconnectSpy.mock.calls[1][1]).toBeUndefined();

    fakeClose(1011);
    expect(reconnectSpy).toHaveBeenCalledTimes(3);

    fakeClose(1000);
    expect(reconnectSpy).toHaveBeenCalledTimes(3);
    client.disconnect();
    await new Promise((r) => setTimeout(r, 20));
  });
});

describe("handleZeroHubMessage — hubInfo roster reconciliation", () => {
  it("prunes a peer absent from the roster and tears down its RTC connection", () => {
    const client = makeClient();
    const stale = makePeer("3");
    const kept = makePeer("2");
    client.peers = { "2": kept.peer, "3": stale.peer };

    const serverMessage: ServerMessage = {
      hubInfoMessage: {
        id: "hub-1",
        createTime: new Date(),
        myPeerId: "1",
        hubMetadata: "",
        peers: [{ id: "2", metadata: "{}", joinTime: undefined }],
      },
    };

    client.handleZeroHubMessage(serverMessage);

    // Stale peer "3" is gone and its RTC connection was closed.
    expect(client.peers["3"]).toBeUndefined();
    expect(stale.rtc.closeCalls).toBe(1);
    // Kept peer "2" is still in the map and untouched.
    expect(client.peers["2"]).toBe(kept.peer);
    expect(kept.rtc.closeCalls).toBe(0);
    // Roster was applied to the hub info.
    expect(client.myPeerId).toBe("1");
    expect(client.hubInfo?.id).toBe("hub-1");
  });

  it("adds a peer that is in the roster but not yet tracked locally", () => {
    const client = makeClient();
    client.peers = {};

    const serverMessage: ServerMessage = {
      hubInfoMessage: {
        id: "hub-1",
        createTime: new Date(),
        myPeerId: "1",
        hubMetadata: "",
        peers: [{ id: "9", metadata: "{}", joinTime: undefined }],
      },
    };

    client.handleZeroHubMessage(serverMessage);

    expect(client.peers["9"]).toBeDefined();
    expect(client.peers["9"].status).toBe(PeerStatus.Pending);
  });

  it("does not prune a peer that is still in the roster", () => {
    const client = makeClient();
    const kept = makePeer("2");
    client.peers = { "2": kept.peer };

    const serverMessage: ServerMessage = {
      hubInfoMessage: {
        id: "hub-1",
        createTime: new Date(),
        myPeerId: "1",
        hubMetadata: "",
        peers: [{ id: "2", metadata: "{}", joinTime: undefined }],
      },
    };

    client.handleZeroHubMessage(serverMessage);

    expect(client.peers["2"]).toBe(kept.peer);
    expect(kept.rtc.closeCalls).toBe(0);
  });
});

describe("updatePeerStatus", () => {
  it("logs an error for an unknown peer id and does not throw", () => {
    const client = makeClient();
    const topology = client.topology as unknown as FakeTopology;
    const logger = client.logger as unknown as FakeLogger;

    expect(() =>
      client.updatePeerStatus("missing", PeerStatus.Connected)
    ).not.toThrow();
    expect(logger.error).toHaveBeenCalled();
    expect(topology.onPeerStatusChange).not.toHaveBeenCalled();
  });

  it("updates the status of a known peer and notifies the topology", () => {
    const client = makeClient();
    const { peer } = makePeer("2");
    client.peers = { "2": peer };
    const topology = client.topology as unknown as FakeTopology;

    client.updatePeerStatus("2", PeerStatus.Connected);

    expect(peer.status).toBe(PeerStatus.Connected);
    expect(topology.onPeerStatusChange).toHaveBeenCalledWith(peer);
  });

  it("a throwing topology handler does not mask the user onPeerStatusChange", () => {
    const client = makeClient();
    const { peer } = makePeer("2");
    client.peers = { "2": peer };
    const topology = client.topology as unknown as FakeTopology;
    topology.onPeerStatusChange.mockImplementation(() => {
      throw new Error("topology boom");
    });
    const userHandler = vi.fn();
    client.onPeerStatusChange = userHandler;

    expect(() =>
      client.updatePeerStatus("2", PeerStatus.Connected)
    ).not.toThrow();

    // The status is applied and the user callback still fires even though the
    // topology handler threw first.
    expect(peer.status).toBe(PeerStatus.Connected);
    expect(userHandler).toHaveBeenCalledTimes(1);
    expect(userHandler).toHaveBeenCalledWith(peer);
    expect((client.logger as unknown as FakeLogger).error).toHaveBeenCalledWith(
      "topology.onPeerStatusChange handler threw",
      expect.anything()
    );
  });

  it("a throwing onPeerStatusChange does not stop other peers' status updates", () => {
    const client = makeClient();
    const p1 = makePeer("1");
    const p2 = makePeer("2");
    client.peers = { "1": p1.peer, "2": p2.peer };
    client.onPeerStatusChange = (peer) => {
      if (peer.id === "1") {
        throw new Error("user handler boom");
      }
    };

    // Updating peer "1" must not throw out of the dispatcher…
    expect(() =>
      client.updatePeerStatus("1", PeerStatus.Connected)
    ).not.toThrow();
    expect(p1.peer.status).toBe(PeerStatus.Connected);

    // …and peer "2" keeps receiving status updates afterwards.
    client.updatePeerStatus("2", PeerStatus.Connected);
    expect(p2.peer.status).toBe(PeerStatus.Connected);
    expect((client.logger as unknown as FakeLogger).error).toHaveBeenCalledWith(
      "onPeerStatusChange handler threw",
      expect.anything()
    );
  });
});

describe("onmessage — corrupt frame isolation", () => {
  // The onmessage handler is wired by the REAL connectToZeroHub (the
  // connect stub is used by the reconnect specs only); a fake host name
  // makes the underlying WebSocket dial fail harmlessly — the spec only
  // invokes the onmessage handler synchronously.
  let client: ZeroHubClient;

  afterEach(() => {
    client?.disconnect();
  });

  /** Get the onmessage handler the real connectToZeroHub registered. */
  function onMessage(): () => unknown {
    // The fake host makes the underlying dial fail (error + close 1006 →
    // a rejected connect Promise); swallow the rejection — the spec only
    // invokes the onmessage handler synchronously.
    client
      .connectToZeroHub(new URL("ws://fake-host-never-resolves/v1/hubs/join"))
      .catch(() => {});
    return (client.ws as unknown as { onmessage: () => unknown }).onmessage;
  }

  it("a frame that makes ServerMessage.decode throw does not break the socket or subsequent messages", () => {
    client = makeClient();
    const handler = onMessage();
    const errors: Error[] = [];
    client.onZeroHubError = (err) => errors.push(err);
    const hubInfoCalls = vi.fn();
    client.onHubInfo = hubInfoCalls;

    // Frame 1: corrupt payload — decode throws. The handler must NOT throw
    // (an uncaught throw out of a WebSocket onmessage aborts the signaling
    // receive loop for every peer).
    expect(() =>
      handler({ data: new Uint8Array([0xff, 0xff, 0xff, 0xff]) } as never)
    ).not.toThrow();
    expect(hubInfoCalls).not.toHaveBeenCalled();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
    expect((client.logger as unknown as FakeLogger).error).toHaveBeenCalledWith(
      "failed to process ZeroHub message",
      expect.anything()
    );

    // Frame 2: a valid hubInfoMessage still decodes and dispatches — the
    // receive loop is not wedged.
    const validFrame = ServerMessage.encode({
      hubInfoMessage: {
        id: "hub-1",
        createTime: new Date(),
        myPeerId: "1",
        hubMetadata: "",
        peers: [],
      },
    }).finish();
    expect(() => handler({ data: validFrame } as never)).not.toThrow();
    expect(hubInfoCalls).toHaveBeenCalledTimes(1);
    expect(client.hubInfo?.id).toBe("hub-1");
    expect(client.myPeerId).toBe("1");
  });

  it("a throwing onPeerStatusChange inside the dispatcher cannot escape the onmessage handler", () => {
    client = makeClient();
    const handler = onMessage();
    const { peer } = makePeer("3");
    client.peers = { "3": peer };
    client.onPeerStatusChange = () => {
      throw new Error("user handler boom");
    };

    // A join for a peer we do NOT already track: dispatches addPeer ->
    // updatePeerStatus -> the throwing user handler. Nothing may escape the
    // event handler.
    client.myPeerId = "1";
    client.hubInfo = { id: "hub-1", metadata: {}, createTime: new Date() };
    const validFrame = ServerMessage.encode({
      peerJoinedMessage: {
        peer: { id: "4", metadata: "{}", joinTime: undefined },
      },
    }).finish();

    expect(() => handler({ data: validFrame } as never)).not.toThrow();
    // The new peer was registered (guard catches after the status apply)…
    expect(client.peers["4"]).toBeDefined();
    expect(client.peers["4"].status).toBe(PeerStatus.Pending);
    // …and the pre-existing peer is untouched.
    expect(peer.status).toBe(PeerStatus.Pending);
    expect((client.logger as unknown as FakeLogger).error).toHaveBeenCalledWith(
      "onPeerStatusChange handler threw",
      expect.anything()
    );
  });

  it("a throwing onHubInfo does not abort roster reconciliation for that hubInfoMessage", () => {
    client = makeClient();
    const handler = onMessage();
    client.onHubInfo = () => {
      throw new Error("hub info boom");
    };
    // A stale peer from a previous session that is NOT in the new roster:
    // it must still be pruned below the throwing callback.
    client.peers = { "9": makePeer("9").peer };

    const validFrame = ServerMessage.encode({
      hubInfoMessage: {
        id: "hub-1",
        createTime: new Date(),
        myPeerId: "1",
        hubMetadata: "",
        peers: [{ id: "2", metadata: "{}", joinTime: undefined }],
      },
    }).finish();

    // Nothing may escape the event handler — the failure is isolated inside
    // `handleZeroHubMessage`, so the OUTER onmessage catch (and therefore
    // `onZeroHubError`) must NOT fire.
    expect(() => handler({ data: validFrame } as never)).not.toThrow();
    const logger = client.logger as unknown as FakeLogger;
    expect(logger.error).toHaveBeenCalledWith(
      "onHubInfo handler threw",
      expect.anything()
    );
    expect(logger.error).not.toHaveBeenCalledWith(
      "failed to process ZeroHub message",
      expect.anything()
    );
    expect(client.onZeroHubError).toBeUndefined();

    // The hub info state was applied before the callback ran…
    expect(client.myPeerId).toBe("1");
    expect(client.hubInfo?.id).toBe("hub-1");
    // …and the roster reconciliation continued past the throwing callback:
    // the roster peer was added…
    expect(client.peers["2"]).toBeDefined();
    expect(client.peers["2"].status).toBe(PeerStatus.Pending);
    // …and the stale peer was pruned (the reconciliation's prune pass ran).
    expect(client.peers["9"]).toBeUndefined();
  });
});

describe("WebRTC event boundary — throwing user callbacks are isolated", () => {
  it("a throwing answerer onDataChannel does not escape the ondatachannel handler", () => {
    const logger = new FakeLogger();
    const { peer, rtc } = makePeer("2");
    setupDataChannel(
      {
        dataChannelConfig: {
          onDataChannel: () => {
            throw new Error("user channel boom");
          },
        },
      } as Config,
      peer,
      logger as unknown as ZeroHubLogger,
      false
    );
    const channel = { label: "0" };

    // The handler is installed and a throw inside the user callback must
    // never escape it (an uncaught throw here is a raw page exception —
    // the exact failure class #107 eliminated at the signaling boundary).
    expect(rtc.ondatachannel).toBeDefined();
    expect(() => rtc.ondatachannel?.({ channel } as never)).not.toThrow();
    expect(logger.error).toHaveBeenCalledWith(
      "onDataChannel handler threw",
      expect.anything()
    );
  });

  it("keeps delivering subsequent channel events after a throwing onDataChannel", () => {
    const logger = new FakeLogger();
    const seen: unknown[] = [];
    const { peer, rtc } = makePeer("2");
    setupDataChannel(
      {
        dataChannelConfig: {
          onDataChannel: (p, dc) => {
            // Record the delivery, then throw on the FIRST event only:
            // the guard must keep the handler alive for later events.
            seen.push([p.id, dc.label]);
            if (seen.length === 1) {
              throw new Error("first channel boom");
            }
          },
        },
      } as Config,
      peer,
      logger as unknown as ZeroHubLogger,
      false
    );

    // First event throws; the second must still reach the user callback —
    // the guard must not swallow legitimate channel events or detach the
    // handler. Both events recorded a delivery before the first one threw.
    expect(() =>
      rtc.ondatachannel?.({ channel: { label: "0" } } as never)
    ).not.toThrow();
    expect(() =>
      rtc.ondatachannel?.({ channel: { label: "1" } } as never)
    ).not.toThrow();
    expect(seen).toEqual([
      ["2", "0"],
      ["2", "1"],
    ]);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("a throwing mediaChannelConfig.onTrack does not escape the ontrack handler", () => {
    const logger = new FakeLogger();
    const { peer, rtc } = makePeer("2");
    setupMediaChannel(
      {
        mediaChannelConfig: {
          onTrack: () => {
            throw new Error("user track boom");
          },
        },
      } as Config,
      peer,
      logger as unknown as ZeroHubLogger
    );
    const trackEvent = { streams: [{}] } as never;

    expect(rtc.ontrack).toBeDefined();
    expect(() => rtc.ontrack?.(trackEvent)).not.toThrow();
    expect(logger.error).toHaveBeenCalledWith(
      "onTrack handler threw",
      expect.anything()
    );
  });

  it("keeps delivering subsequent track events after a throwing onTrack", () => {
    const logger = new FakeLogger();
    const seen: unknown[] = [];
    const { peer, rtc } = makePeer("2");
    setupMediaChannel(
      {
        mediaChannelConfig: {
          onTrack: (p, event) => {
            // Record the delivery, then throw on the FIRST event only.
            seen.push(p.id);
            if (seen.length === 1) {
              throw new Error("first track boom");
            }
            void event;
          },
        },
      } as Config,
      peer,
      logger as unknown as ZeroHubLogger
    );

    expect(() => rtc.ontrack?.({} as never)).not.toThrow();
    expect(() => rtc.ontrack?.({} as never)).not.toThrow();
    // Both events reached the callback (the first recorded its delivery
    // before throwing).
    expect(seen).toEqual(["2", "2"]);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("a throwing onOffer with autoAnswer:false is isolated and not surfaced as a signaling error", () => {
    const client = makeClient();
    const { peer } = makePeer("2");
    client.peers = { "2": peer };
    client.myPeerId = "1";
    client.config.autoAnswer = false;
    const signalingErrors: unknown[] = [];
    client.onZeroHubError = (err) => signalingErrors.push(err);
    client.onOffer = () => {
      throw new Error("manual offer boom");
    };

    const serverMessage: ServerMessage = {
      offerMessage: { offerPeerId: "2", offerSdp: "v=0 fake-sdp" },
    };

    expect(() => client.handleZeroHubMessage(serverMessage)).not.toThrow();

    // The status transition still applied before the callback ran…
    expect(peer.status).toBe(PeerStatus.AnswerPending);
    // …and the throw was isolated with the standard "handler threw" log…
    expect((client.logger as unknown as FakeLogger).error).toHaveBeenCalledWith(
      "onOffer handler threw",
      expect.anything()
    );
    // …but NOT misclassified as a connection-level/signaling failure.
    expect(signalingErrors).toHaveLength(0);
    expect(
      (client.logger as unknown as FakeLogger).error
    ).not.toHaveBeenCalledWith(
      "failed to process ZeroHub message",
      expect.anything()
    );
  });
});

describe("reconnect — 1001 close reason host validation", () => {
  it("falls back to host failover when the 1001 reason is not a well-formed host", async () => {
    vi.useFakeTimers();
    const client = makeClient(["first-host", "second-host"]);
    client.config.maxReconnectAttempts = 1;
    markEstablished(client);
    const connectCalls = stubConnectToZeroHub(client);

    client.reconnect(new URL("ws://first-host/hub"), "Server going away");
    // Let any queued microtasks settle before asserting.
    await vi.advanceTimersByTimeAsync(0);

    // `this.host` was NOT corrupted with the human-readable reason: the
    // host state stayed on the first host, whose bounded same-host retry
    // is pending behind the backoff timer.
    expect(client.host).toBe("first-host");
    expect(client.hostIndex).toBe(0);
    expect(attempts(client)).toBe(1);

    // The retry re-dials the SAME host…
    await vi.advanceTimersByTimeAsync(30_000);
    expect(connectCalls).toHaveLength(1);
    expect(connectCalls[0].host).toBe("first-host");

    // …and when it fails too, the automatic failover path advances the
    // host state to the next host instead.
    client.reconnect(new URL("ws://first-host/hub"));
    await vi.advanceTimersByTimeAsync(0);
    expect(client.host).toBe("second-host");
    expect(client.hostIndex).toBe(1);
    expect(connectCalls).toHaveLength(2);
    expect(connectCalls[1].host).toBe("second-host");
  });

  it("redirects to a well-formed 1001 host without corrupting host state", () => {
    const client = makeClient(["first-host", "other-host"]);
    const connectCalls = stubConnectToZeroHub(client);
    const url = new URL("ws://first-host/hub");

    client.reconnect(url, "new-host");

    expect(client.host).toBe("new-host");
    // `new-host` is not in the configured list, so `hostIndex` is unchanged.
    expect(client.hostIndex).toBe(0);
    expect(connectCalls).toHaveLength(1);
    expect(connectCalls[0].host).toBe("new-host");
  });

  it("redirects (not failover) on non-canonical-but-valid 1001 reasons the server accepts", () => {
    // Regression for the isWellFormedHost divergence: these are valid
    // migration targets the server's validateBackupHost accepts and emits,
    // but whose raw spelling differs from the WHATWG-canonical form
    // (uppercase host, zero-padded port, zero-padded octal IPv4, uppercase
    // IPv6). The old raw-string round-trip rejected them and fell back to
    // host-failover instead of connecting to the redirected host.
    const reasons = [
      "NEW.example.com:8443", // uppercase hostname
      "a.com:00080", // zero-padded port
      "10.001.001.001", // zero-padded (octal) IPv4 octets
      "[A:1:2:3:4:5:6:7]:80", // uppercase IPv6 literal
    ];
    for (const reason of reasons) {
      const client = makeClient(["first-host"]);
      const connectCalls = stubConnectToZeroHub(client);

      client.reconnect(new URL("ws://first-host/hub"), reason);

      // The redirect is honored: host state is updated verbatim and the
      // client connects to the redirected target — NOT the failover path.
      // `currentURL.host` is set via the WHATWG URL setter, so the connect
      // target is the canonical form (lowercased / port-normalized) of
      // `reason` — the same target the server emits, per the docblock.
      expect(client.host, `host for ${JSON.stringify(reason)}`).toBe(reason);
      expect(client.hostIndex, `hostIndex for ${JSON.stringify(reason)}`).toBe(
        0
      );
      expect(
        connectCalls,
        `connects for ${JSON.stringify(reason)}`
      ).toHaveLength(1);
      expect(
        connectCalls[0].host,
        `canonical target for ${JSON.stringify(reason)}`
      ).toBe(new URL(`http://${reason}`).host);
      // The "falling back to host failover" warning must NOT have fired.
      const logger = client.logger as unknown as FakeLogger;
      expect(
        logger.warn.mock.calls.some(
          (c) =>
            typeof c[0] === "string" &&
            c[0].includes("falling back to host failover")
        ),
        `failover warning for ${JSON.stringify(reason)}`
      ).toBe(false);
    }
  });
});

describe("reconnect — same-host retry-with-backoff on abnormal close", () => {
  const url = () => new URL("ws://only-host:8080/v1/hubs/join?id=hub");

  it("single abnormal close on the last host retries the SAME host and does not surface onZeroHubError", async () => {
    vi.useFakeTimers();
    const client = makeClient(["only-host"]);
    markEstablished(client);
    const connectCalls = stubConnectToZeroHub(client);

    // The realistic trigger: the onclose 1006/1011 branch calls
    // `reconnect(url)` with no new host. On the single (last) host this must
    // schedule a same-host retry, not give up.
    client.reconnect(url());

    // No terminal error yet (the budget has 10 attempts left by default), and
    // nothing dialed yet: the retry is deferred behind the backoff timer.
    expect(client.onZeroHubError).toBeUndefined();
    expect(connectCalls).toHaveLength(0);
    expect(client.hostIndex).toBe(0);
    expect(client.host).toBe("only-host");
    // Exactly one same-host retry was queued.
    expect(attempts(client)).toBe(1);

    // The first retry dials the SAME host (backoff 250ms * ±20% < 400ms).
    // `advanceTimersByTimeAsync` both fires the timer and flushes any
    // microtasks, so the stubbed dial has landed by the time we assert.
    await vi.advanceTimersByTimeAsync(400);
    expect(connectCalls).toHaveLength(1);
    expect(connectCalls[0].host).toBe("only-host:8080");
    expect(attempts(client)).toBe(1);
    expect(client.onZeroHubError).toBeUndefined();
  });

  it("falls through to the terminal onZeroHubError only after the retry budget is exhausted", async () => {
    vi.useFakeTimers();
    const client = makeClient(["only-host"]);
    client.config.maxReconnectAttempts = 3;
    markEstablished(client);
    const connectCalls = stubConnectToZeroHub(client);
    const errors: Error[] = [];
    client.onZeroHubError = (err) => {
      errors.push(err);
    };

    // Three abnormal closes: each queues a same-host retry that dials the
    // SAME host. The stubbed dial does not reset the budget, so all three
    // stay within the budget of three.
    for (let i = 1; i <= 3; i += 1) {
      client.reconnect(url());
      // Fire the just-queued retry (backoff ≤ 30s cap) so the next close has
      // a (mock) socket to fire on, mirroring the real blip → retry → blip.
      await vi.advanceTimersByTimeAsync(30_000);
      expect(connectCalls).toHaveLength(i);
      expect(connectCalls[i - 1].host).toBe("only-host:8080");
    }
    expect(attempts(client)).toBe(3);
    expect(errors).toHaveLength(0);

    // The 4th abnormal close: the retry budget is exhausted. This is the
    // single (last) host, so there is no next host to fail over to and no
    // wraparound round left — the terminal error surfaces.
    client.reconnect(url());
    // The terminal branch is synchronous; flush microtasks before asserting.
    await vi.advanceTimersByTimeAsync(1);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe(
      "all ZeroHub hosts are not working, please check the ZeroHub hosts"
    );
  });

  it("the terminal error fires exactly once: a further blip on a leftover socket is a no-op", async () => {
    vi.useFakeTimers();
    const client = makeClient(["only-host"]);
    client.config.maxReconnectAttempts = 1;
    markEstablished(client);
    const connectCalls = stubConnectToZeroHub(client);
    const errors: Error[] = [];
    client.onZeroHubError = (err) => {
      errors.push(err);
    };

    // Blip #1 queues the single same-host retry; fire it.
    client.reconnect(url());
    await vi.advanceTimersByTimeAsync(30_000);
    expect(connectCalls).toHaveLength(1);

    // Blip #2: the budget is spent and there is no next host / round left —
    // the terminal error fires exactly once and latches `reconnectAbandoned`.
    client.reconnect(url());
    await vi.advanceTimersByTimeAsync(1);
    expect(errors).toHaveLength(1);

    // A further abnormal close on a leftover socket must be a no-op: it does
    // NOT re-fire the terminal error and does NOT re-dial.
    client.reconnect(url());
    await vi.advanceTimersByTimeAsync(30_000);
    expect(errors).toHaveLength(1);
    expect(connectCalls).toHaveLength(1);
  });

  it("a fresh entry-point dial after the terminal error clears the latch and starts a new session", async () => {
    vi.useFakeTimers();
    const client = makeClient(["only-host"]);
    client.config.maxReconnectAttempts = 1;
    markEstablished(client);
    const connectCalls = stubConnectToZeroHub(client);
    const errors: Error[] = [];
    client.onZeroHubError = (err) => {
      errors.push(err);
    };

    // Drive the client to the terminal state (latch set).
    client.reconnect(url());
    await vi.advanceTimersByTimeAsync(30_000);
    client.reconnect(url());
    await vi.advanceTimersByTimeAsync(1);
    expect(errors).toHaveLength(1);

    // The application explicitly reconnects: a fresh entry-point dial clears
    // the latch, and the server's hub info confirms the new session — which
    // also resets the attempt counter (the budget only refills on a
    // CONFIRMED connection, not on a bare dial).
    await client.connectToZeroHub(
      new URL("ws://only-host:8080/v1/hubs/join?id=hub")
    );
    client.handleZeroHubMessage({
      hubInfoMessage: {
        id: "hub-1",
        createTime: new Date(),
        myPeerId: "1",
        hubMetadata: "",
        peers: [],
      },
    } as never);

    // A subsequent abnormal close is a normal same-host retry again (full
    // budget), not a terminal re-fire: without the latch clear it would have
    // been a no-op, without the hub-info budget reset it would have re-fired
    // the terminal error.
    client.reconnect(url());
    await vi.advanceTimersByTimeAsync(30_000);
    expect(errors).toHaveLength(1);
    expect(attempts(client)).toBe(1);
    expect(connectCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("a confirmed connection (hub info) resets the retry budget and any pending retry", async () => {
    vi.useFakeTimers();
    const client = makeClient(["only-host"]);
    markEstablished(client);
    const connectCalls = stubConnectToZeroHub(client);
    client.reconnect(url());
    expect(attempts(client)).toBe(1);

    // The server confirms the (re)connection with its hub info: the budget
    // must reset to zero and any pending retry must be cancelled.
    client.handleZeroHubMessage({
      hubInfoMessage: {
        id: "hub-1",
        createTime: new Date(),
        myPeerId: "1",
        hubMetadata: "",
        peers: [],
      },
    } as never);
    expect(attempts(client)).toBe(0);

    // The stale timer must abort: the state reset bumped the generation.
    await vi.advanceTimersByTimeAsync(400);
    expect(connectCalls).toHaveLength(0);

    // The next abnormal close gets a FULL budget, not the remainder: with a
    // budget of three, three further closes must all still retry the same
    // host (a leftover budget of two would have made the third terminal).
    const errors: Error[] = [];
    client.onZeroHubError = (err) => {
      errors.push(err);
    };
    client.config.maxReconnectAttempts = 3;
    for (let i = 1; i <= 3; i += 1) {
      client.reconnect(url());
      await vi.advanceTimersByTimeAsync(30_000);
      expect(connectCalls).toHaveLength(i);
    }
    expect(errors).toHaveLength(0);
    expect(attempts(client)).toBe(3);
  });

  it("respects a custom maxReconnectAttempts / reconnectBaseBackoffMs", async () => {
    vi.useFakeTimers();
    const client = makeClient(["only-host"]);
    client.config.maxReconnectAttempts = 1;
    client.config.reconnectBaseBackoffMs = 100;
    markEstablished(client);
    const connectCalls = stubConnectToZeroHub(client);

    client.reconnect(url());
    // Backoff for attempt 1 is 100ms * ±20% → strictly under 150ms.
    await vi.advanceTimersByTimeAsync(150);
    expect(connectCalls).toHaveLength(1);

    // Budget of one is spent: the next abnormal close is terminal.
    const errors: Error[] = [];
    client.onZeroHubError = (err) => {
      errors.push(err);
    };
    client.reconnect(url());
    await vi.advanceTimersByTimeAsync(1);
    expect(errors).toHaveLength(1);
  });

  it("a migration redirect (1001) clears a queued same-host retry", async () => {
    vi.useFakeTimers();
    const client = makeClient(["a", "b"]);
    const connectCalls = stubConnectToZeroHub(client);

    // Simulate: a previous same-host retry is pending (attempts = 1), then a
    // 1001 redirect to host `b` lands. The redirect must hand `b` a full
    // retry budget, not the leftover of `a`'s.
    (client as unknown as { reconnectAttempts: number }).reconnectAttempts = 1;
    client.reconnect(new URL("ws://a/hub"), "b");
    expect(connectCalls).toHaveLength(1);
    expect(connectCalls[0].host).toBe("b");
    expect(attempts(client)).toBe(0);
    // The stale retry timer (if any) must not dial host `a` behind the
    // redirect.
    await vi.advanceTimersByTimeAsync(400);
    expect(connectCalls).toHaveLength(1);
  });

  it("multi-host: a non-last host re-dials the SAME host until its retry budget is spent, then fails over exactly once", async () => {
    vi.useFakeTimers();
    const client = makeClient(["first-host", "second-host"]);
    client.config.maxReconnectAttempts = 1;
    markEstablished(client);
    const connectCalls = stubConnectToZeroHub(client);
    // The client is established on the first host and the socket closed with
    // 1006: the onclose branch calls `reconnect(url)` with no new host while
    // hostIndex is still 0.
    client.reconnect(new URL("ws://first-host/hub"));

    // A single failure must NOT advance hostIndex: the current host gets a
    // bounded same-host retry budget with backoff first (a blip may be
    // transient even on a non-last host).
    await vi.advanceTimersByTimeAsync(0);
    expect(connectCalls).toHaveLength(0);
    expect(client.hostIndex).toBe(0);
    expect(attempts(client)).toBe(1);

    // The retry dials the SAME host, not the next one.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(connectCalls).toHaveLength(1);
    expect(connectCalls[0].host).toBe("first-host");
    expect(client.hostIndex).toBe(0);

    // The retry fails again: the budget is now spent, so failover advances
    // hostIndex exactly once — to `second-host`, not two hosts past it.
    client.reconnect(new URL("ws://first-host/hub"));
    await vi.advanceTimersByTimeAsync(0);
    expect(connectCalls).toHaveLength(2);
    expect(connectCalls[1].host).toBe("second-host");
    expect(client.hostIndex).toBe(1);
    expect(client.host).toBe("second-host");
    expect(attempts(client)).toBe(0);
  });

  it("initial-connection dial failure fails over IMMEDIATELY (no same-host retry)", async () => {
    vi.useFakeTimers();
    const client = makeClient(["first-host", "second-host"]);
    const connectCalls = stubConnectToZeroHub(client);
    // A fresh client's FIRST dial refused: `isInitialConnection` is still
    // true, so the onclose 1006 branch must NOT burn the retry budget on a
    // host that never connected — it advances hostIndex exactly once,
    // immediately (the invariant pinned by test/tests/multihosts.spec.ts).
    client.reconnect(new URL("ws://first-host/hub"));
    await vi.advanceTimersByTimeAsync(0);
    expect(connectCalls).toHaveLength(1);
    expect(connectCalls[0].host).toBe("second-host");
    expect(client.hostIndex).toBe(1);
    expect(client.host).toBe("second-host");
    expect(attempts(client)).toBe(0);
    // No retry timer is left pending: advancing the timers dials nowhere.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(connectCalls).toHaveLength(1);
  });

  it("disconnect() cancels a queued same-host retry: no stray socket, no resurrection", async () => {
    vi.useFakeTimers();
    const client = makeClient(["only-host"]);
    markEstablished(client);
    const connectCalls = stubConnectToZeroHub(client);
    client.reconnect(url());
    expect(attempts(client)).toBe(1);

    client.disconnect();
    expect(attempts(client)).toBe(0);

    // The pending retry must not fire after teardown (generation bumped).
    await vi.advanceTimersByTimeAsync(400);
    expect(connectCalls).toHaveLength(0);

    // And `reconnect()` itself must refuse while disconnected.
    client.reconnect(url());
    expect(connectCalls).toHaveLength(0);
  });
});

describe("armSendOnIceReady — single-send guard + trickle ICE", () => {
  let client: ZeroHubClient;
  let sendIceSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    client = makeClient();
    // Spying the forwarder keeps the fake from throwing (no `ws` in this
    // harness) while still recording every trickled candidate.
    sendIceSpy = vi.fn();
    client.sendIceCandidateToWebsocket = sendIceSpy as never;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires the send exactly once on the first candidate and trickles the rest", () => {
    const sendOnce = vi.fn();
    const rtc = new FakeRTCPeerConnection();
    // A local SDP has been set (as the real offer/answer paths do before
    // arming the send).
    rtc.localDescription = {
      type: "offer",
      sdp: "v=0",
    } as RTCSessionDescription;

    invokeArmSend(client, "2", rtc, sendOnce);

    // The first candidate that arrives fires the SDP send AND trickles the
    // candidate to the remote peer.
    rtc.onicecandidate?.({ candidate: { candidate: "candidate:1" } });
    expect(sendOnce).toHaveBeenCalledTimes(1);
    expect(sendIceSpy).toHaveBeenCalledTimes(1);
    expect(sendIceSpy).toHaveBeenCalledWith("2", { candidate: "candidate:1" });

    // A later candidate does not re-send the SDP but IS trickled.
    rtc.onicecandidate?.({ candidate: { candidate: "candidate:2" } });
    expect(sendOnce).toHaveBeenCalledTimes(1);
    expect(sendIceSpy).toHaveBeenCalledTimes(2);
    expect(sendIceSpy).toHaveBeenLastCalledWith("2", {
      candidate: "candidate:2",
    });

    // The gathering-complete marker does not re-send or trickle anything.
    rtc.onicecandidate?.({ candidate: null });
    expect(sendOnce).toHaveBeenCalledTimes(1);
    expect(sendIceSpy).toHaveBeenCalledTimes(2);
  });

  it("fires the send once from the timer and trickles late candidates", () => {
    client.config = { ...client.config, waitIceCandidatesTimeout: 50 };
    const sendOnce = vi.fn();
    const rtc = new FakeRTCPeerConnection();
    // `setLocalDescription` is awaited before arming in the real
    // sendOffer/sendAnswer flow, so a local SDP is present when the guard
    // runs.
    rtc.localDescription = {
      type: "offer",
      sdp: "v=0",
    } as RTCSessionDescription;

    invokeArmSend(client, "3", rtc, sendOnce);

    // No candidate arrives; the timer fires the send (no trickle yet).
    vi.advanceTimersByTime(50);
    expect(sendOnce).toHaveBeenCalledTimes(1);
    expect(sendIceSpy).not.toHaveBeenCalled();

    // A late candidate after the send does not re-send but IS trickled.
    rtc.onicecandidate?.({ candidate: { candidate: "candidate:late" } });
    expect(sendOnce).toHaveBeenCalledTimes(1);
    expect(sendIceSpy).toHaveBeenCalledTimes(1);
    expect(sendIceSpy).toHaveBeenCalledWith("3", {
      candidate: "candidate:late",
    });
  });
});

/** Invoke the private `armSendOnIceReady` without widening public types. */
function invokeArmSend(
  client: ZeroHubClient,
  peerId: string,
  rtc: FakeRTCPeerConnection,
  sendOnce: () => void
) {
  (
    client as unknown as {
      armSendOnIceReady(
        peerId: string,
        rtcConn: RTCPeerConnection,
        sendOnce: () => void
      ): void;
    }
  ).armSendOnIceReady(peerId, rtc as unknown as RTCPeerConnection, sendOnce);
}

/**
 * A fake signaling socket that stands in for `client.ws`: it exposes the
 * `readyState` the client's `sendZeroHubMessage` checks, and `send()`
 * throws an `InvalidStateError` like a real browser when the socket is not
 * OPEN. Lets specs deterministically simulate the CONNECTING/CLOSING window
 * without a live WebSocket.
 */
class FakeWebSocket {
  public readyState = 0; // CONNECTING
  public sent: unknown[] = [];

  send(data: unknown) {
    if (this.readyState !== WebSocket.OPEN) {
      throw new DOMException("not open", "InvalidStateError");
    }
    this.sent.push(data);
  }
}

describe("sendZeroHubMessage — socket readyState guard", () => {
  it("throws a clean error for a CONNECTING socket instead of a raw InvalidStateError from ws.send()", () => {
    const client = makeClient();
    const ws = new FakeWebSocket(); // readyState: CONNECTING
    client.ws = ws as unknown as WebSocket;

    expect(() => client.sendZeroHubMessage({})).toThrowError(/not open/i);
    expect(() => client.sendZeroHubMessage({})).not.toThrow(DOMException);
    expect(ws.sent).toHaveLength(0);
  });

  it("throws a clean error for a CLOSING/CLOSED socket", () => {
    const client = makeClient();
    const ws = new FakeWebSocket();
    ws.readyState = 2; // CLOSING
    client.ws = ws as unknown as WebSocket;

    expect(() => client.sendZeroHubMessage({})).toThrowError(/not open/i);

    ws.readyState = 3; // CLOSED
    expect(() => client.sendZeroHubMessage({})).toThrowError(/not open/i);
    expect(ws.sent).toHaveLength(0);
  });

  it("delivers on an OPEN socket", () => {
    const client = makeClient();
    const ws = new FakeWebSocket();
    ws.readyState = WebSocket.OPEN;
    client.ws = ws as unknown as WebSocket;

    expect(() => client.sendZeroHubMessage({})).not.toThrow();
    expect(ws.sent).toHaveLength(1);
  });
});

describe("armSendOnIceReady — SDP send across a non-OPEN signaling socket", () => {
  let client: ZeroHubClient;
  let sendIceSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    client = makeClient();
    sendIceSpy = vi.fn();
    client.sendIceCandidateToWebsocket = sendIceSpy as never;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("a failed SDP send on a CONNECTING socket does not throw and does not consume the single-send guard", () => {
    client.config = { ...client.config, waitIceCandidatesTimeout: 50 };
    const sendOnce = vi.fn(() => {
      throw new Error(
        "ZeroHub WebSocket is not open (reconnecting?); message not sent"
      );
    });
    const rtc = new FakeRTCPeerConnection();
    rtc.localDescription = {
      type: "offer",
      sdp: "v=0",
    } as RTCSessionDescription;

    invokeArmSend(client, "2", rtc, sendOnce);

    // The first candidate hits a non-OPEN socket: the event handler must
    // NOT throw (no uncaught InvalidStateError out of onicecandidate), the
    // candidate itself is still trickled, and the guard must stay open.
    expect(() =>
      rtc.onicecandidate?.({ candidate: { candidate: "candidate:1" } })
    ).not.toThrow();
    expect(sendOnce).toHaveBeenCalledTimes(1);
    expect(sendIceSpy).toHaveBeenCalledTimes(1);

    // A later candidate still attempts delivery exactly once more...
    rtc.onicecandidate?.({ candidate: { candidate: "candidate:2" } });
    expect(sendOnce).toHaveBeenCalledTimes(2);
    expect(sendIceSpy).toHaveBeenCalledTimes(2);
    // ...and the ICE-timeout fallback also retries, because the SDP has
    // still never been delivered — the guard stays open until success.
    vi.advanceTimersByTime(50);
    expect(sendOnce).toHaveBeenCalledTimes(3);
  });

  it("a failed ICE-timeout SDP send on a non-OPEN socket still delivers exactly once on a later candidate", () => {
    client.config = { ...client.config, waitIceCandidatesTimeout: 50 };
    // Socket is CONNECTING when the timer fires, OPEN by the time the next
    // candidate arrives (the reconnect handshake completed in between).
    const sendOnce = vi.fn(() => {
      if (!client.ws || client.ws.readyState !== WebSocket.OPEN) {
        throw new Error(
          "ZeroHub WebSocket is not open (reconnecting?); message not sent"
        );
      }
    });
    const rtc = new FakeRTCPeerConnection();
    rtc.localDescription = {
      type: "offer",
      sdp: "v=0",
    } as RTCSessionDescription;
    const ws = new FakeWebSocket(); // CONNECTING
    client.ws = ws as unknown as WebSocket;

    invokeArmSend(client, "3", rtc, sendOnce);

    // No candidate arrives: the timer fires on a CONNECTING socket. The
    // throw must not escape the timer callback and must not consume the
    // single-send guard — the peer must not be stuck in Pending forever.
    expect(() => vi.advanceTimersByTime(50)).not.toThrow();
    expect(sendOnce).toHaveBeenCalledTimes(1);

    // The reconnect completes; a late candidate delivers the SDP exactly
    // once on the now-OPEN socket.
    ws.readyState = WebSocket.OPEN;
    expect(() =>
      rtc.onicecandidate?.({ candidate: { candidate: "candidate:late" } })
    ).not.toThrow();
    expect(sendOnce).toHaveBeenCalledTimes(2);
    expect((client.logger as unknown as FakeLogger).warn).toHaveBeenCalled();

    // And the guard is now closed: no further attempts, ever.
    rtc.onicecandidate?.({ candidate: { candidate: "candidate:later" } });
    rtc.onicecandidate?.({ candidate: null });
    expect(sendOnce).toHaveBeenCalledTimes(2);
  });
});

describe("onPeerError — per-peer WebRTC signaling failures", () => {
  let client: ZeroHubClient;
  let peerErrorSpy: import("vitest").Mock<(peer: Peer, error: Error) => void>;

  beforeEach(() => {
    vi.useFakeTimers();
    client = makeClient();
    // sendOffer/sendAnswer guard on `this.ws` before reaching the RTC code;
    // give them an OPEN signaling socket so the failure happens in the
    // WebRTC exchange, not the socket guard.
    const ws = new FakeWebSocket();
    ws.readyState = WebSocket.OPEN;
    client.ws = ws as unknown as WebSocket;
    peerErrorSpy = vi.fn();
    client.onPeerError = peerErrorSpy;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sendOffer: fires onPeerError when createOffer rejects, and the promise still rejects", async () => {
    const { peer } = makePeer("5");
    client.peers = { "5": peer };
    // Default fake createOffer rejects with an Error.

    await expect(client.sendOffer("5")).rejects.toThrow(
      "createOffer not implemented in fake"
    );

    expect(peerErrorSpy).toHaveBeenCalledTimes(1);
    const [reportedPeer, error] = peerErrorSpy.mock.calls[0];
    expect(reportedPeer).toBe(peer);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("createOffer not implemented in fake");
    // The logger error path was also exercised.
    expect((client.logger as unknown as FakeLogger).error).toHaveBeenCalled();
  });

  it("sendOffer: fires onPeerError when setLocalDescription rejects", async () => {
    const { peer, rtc } = makePeer("6");
    client.peers = { "6": peer };
    rtc.createOffer = () =>
      Promise.resolve({ type: "offer", sdp: "v=0" } as RTCSessionDescription);
    rtc.setLocalDescription = () =>
      Promise.reject(new Error("local desc boom"));

    await expect(client.sendOffer("6")).rejects.toThrow("local desc boom");

    expect(peerErrorSpy).toHaveBeenCalledTimes(1);
    expect(peerErrorSpy.mock.calls[0][0]).toBe(peer);
    expect(peerErrorSpy.mock.calls[0][1].message).toBe("local desc boom");
  });

  it("sendAnswer: fires onPeerError when setRemoteDescription rejects", async () => {
    const { peer } = makePeer("7");
    client.peers = { "7": peer };

    await expect(client.sendAnswer("7", "v=0-offer")).rejects.toThrow(
      "setRemoteDescription not implemented in fake"
    );

    expect(peerErrorSpy).toHaveBeenCalledTimes(1);
    expect(peerErrorSpy.mock.calls[0][0]).toBe(peer);
  });

  it("sendAnswer: fires onPeerError when createAnswer rejects", async () => {
    const { peer, rtc } = makePeer("8");
    client.peers = { "8": peer };
    rtc.setRemoteDescription = () => Promise.resolve();

    await expect(client.sendAnswer("8", "v=0-offer")).rejects.toThrow(
      "createAnswer not implemented in fake"
    );

    expect(peerErrorSpy).toHaveBeenCalledTimes(1);
    expect(peerErrorSpy.mock.calls[0][0]).toBe(peer);
  });

  it("acceptAnswer: fires onPeerError when setRemoteDescription rejects", async () => {
    const { peer } = makePeer("9");
    client.peers = { "9": peer };

    await expect(client.acceptAnswer("9", "v=0-answer")).rejects.toThrow(
      "setRemoteDescription not implemented in fake"
    );

    expect(peerErrorSpy).toHaveBeenCalledTimes(1);
    expect(peerErrorSpy.mock.calls[0][0]).toBe(peer);
  });

  it("wraps non-Error rejections (e.g. a plain string) in an Error", async () => {
    const { peer, rtc } = makePeer("10");
    client.peers = { "10": peer };
    // Reject with a plain string (non-Error) to verify the client wraps
    // non-Error rejections; cast so the fake's declared
    // Promise<RTCSessionDescription> return type accepts it.
    /* eslint-disable @typescript-eslint/prefer-promise-reject-errors */
    rtc.createOffer = (() =>
      Promise.reject(
        "boom-string"
      )) as unknown as () => Promise<RTCSessionDescription>;
    /* eslint-enable @typescript-eslint/prefer-promise-reject-errors */

    await expect(client.sendOffer("10")).rejects.toThrow("boom-string");

    expect(peerErrorSpy).toHaveBeenCalledTimes(1);
    const error = peerErrorSpy.mock.calls[0][1];
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("boom-string");
  });

  it("does not call onPeerError on a successful sendOffer exchange", async () => {
    const { peer, rtc } = makePeer("11");
    client.peers = { "11": peer };
    rtc.createOffer = () =>
      Promise.resolve({ type: "offer", sdp: "v=0" } as RTCSessionDescription);

    await expect(client.sendOffer("11")).resolves.toBeUndefined();

    // Flush the ICE-timeout fallback so any queued side effects are settled
    // before asserting (the fake never trickles a candidate).
    vi.advanceTimersByTime(client.config.waitIceCandidatesTimeout + 10);
    expect(peerErrorSpy).not.toHaveBeenCalled();
  });

  it("a throwing onPeerError handler is contained: error still re-thrown, logger records it", async () => {
    const { peer } = makePeer("12");
    client.peers = { "12": peer };
    client.onPeerError = () => {
      throw new Error("user handler boom");
    };

    // The user handler must not mask the original signaling failure: the
    // promise still rejects with the RTC error, not "user handler boom".
    await expect(client.acceptAnswer("12", "v=0-answer")).rejects.toThrow(
      "setRemoteDescription not implemented in fake"
    );
    expect((client.logger as unknown as FakeLogger).error).toHaveBeenCalledWith(
      "onPeerError handler threw",
      expect.anything()
    );
  });

  it("does not call onPeerError for an unknown peer (acceptAnswer early-returns)", async () => {
    await expect(client.acceptAnswer("missing", "v=0-answer")).resolves.toBe(
      undefined
    );
    expect(peerErrorSpy).not.toHaveBeenCalled();
  });

  it("does not call onPeerError when no handler is registered", async () => {
    const { peer } = makePeer("13");
    client.peers = { "13": peer };
    delete client.onPeerError;

    await expect(client.acceptAnswer("13", "v=0-answer")).rejects.toThrow();

    // No handler registered: no call, no crash.
    expect(peerErrorSpy).not.toHaveBeenCalled();
  });

  it("reports exactly once for a single failure (no double-firing)", async () => {
    const { peer } = makePeer("14");
    client.peers = { "14": peer };

    await expect(client.acceptAnswer("14", "v=0-answer")).rejects.toThrow();

    expect(peerErrorSpy).toHaveBeenCalledTimes(1);
  });
});

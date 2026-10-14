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
import { LogLevel, PeerStatus } from "./types";
import { ZeroHubLogger } from "./logger";
import { Peer } from "./peer";
import { ServerMessage } from "./proto/zerohub/v1/server_message";
import { ZeroHubClient } from "./zeroHub";

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
  public connectionState = "new";
  public iceConnectionState = "new";

  close() {
    this.closeCalls += 1;
  }

  restartIce() {
    /* no-op */
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
 * reconnect tests don't actually open a WebSocket.
 */
function stubConnectToZeroHub(client: ZeroHubClient) {
  const calls: URL[] = [];
  client.connectToZeroHub = (url: URL) => {
    calls.push(url);
  };
  return calls;
}

// `addPeer` constructs a real `RTCPeerConnection`; stub the global so it
// resolves to the fake under Node.
beforeAll(() => {
  vi.stubGlobal("RTCPeerConnection", class extends FakeRTCPeerConnection {});
});

afterAll(() => {
  vi.unstubAllGlobals();
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
});

describe("reconnect — 1001 close reason host validation", () => {
  it("falls back to host failover when the 1001 reason is not a well-formed host", async () => {
    const client = makeClient(["first-host", "second-host"]);
    const connectCalls = stubConnectToZeroHub(client);

    client.reconnect(new URL("ws://first-host/hub"), "Server going away");
    // Let `getZeroHubBackupHost()` resolve and its `.then` run.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // `this.host` was NOT corrupted with the human-readable reason; the
    // automatic failover path advanced it to the next host instead.
    expect(client.host).toBe("second-host");
    expect(client.hostIndex).toBe(1);
    expect(connectCalls).toHaveLength(1);
    expect(connectCalls[0].host).toBe("second-host");
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
});

describe("armSendOnIceReady — single-send guard", () => {
  let client: ZeroHubClient;

  beforeEach(() => {
    vi.useFakeTimers();
    client = makeClient();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends exactly once when the candidate-complete marker arrives first", () => {
    const sendOnce = vi.fn();
    const rtc = new FakeRTCPeerConnection();
    // A local SDP has been set (as the real offer/answer paths do before
    // arming the send).
    rtc.localDescription = {
      type: "offer",
      sdp: "v=0",
    } as RTCSessionDescription;

    invokeArmSend(client, "2", rtc, sendOnce);

    // A real candidate arrives first — it must NOT trigger the send.
    rtc.onicecandidate?.({ candidate: { candidate: "candidate:1" } });
    expect(sendOnce).not.toHaveBeenCalled();

    // The ICE-gathering-complete marker (no candidate) fires the send once.
    rtc.onicecandidate?.({ candidate: null });
    expect(sendOnce).toHaveBeenCalledTimes(1);

    // A second marker or a late candidate must not re-send.
    rtc.onicecandidate?.({ candidate: null });
    rtc.onicecandidate?.({ candidate: { candidate: "candidate:2" } });
    expect(sendOnce).toHaveBeenCalledTimes(1);
  });

  it("sends exactly once when the waitIceCandidatesTimeout timer fires first", () => {
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

    // No complete marker ever arrives; the timer fires the send.
    vi.advanceTimersByTime(50);
    expect(sendOnce).toHaveBeenCalledTimes(1);

    // A late complete marker after the send must not re-send.
    rtc.onicecandidate?.({ candidate: null });
    expect(sendOnce).toHaveBeenCalledTimes(1);
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

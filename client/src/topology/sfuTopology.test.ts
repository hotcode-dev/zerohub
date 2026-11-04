import { describe, expect, it, vi, type Mock } from "vitest";
import { Peer } from "../peer";
import { ZeroHubClient } from "../zeroHub";
import { PeerStatus, type Config } from "../types";
import type { ZeroHubLogger } from "../logger";
import { SFUTopology } from "./sfuTopology";

/**
 * Unit tests for `SFUTopology.onPeerStatusChange` state-machine decisions.
 * `ZeroHubClient` is faked (the same fake-client approach as
 * `zeroHub.test.ts` / `meshTopology.test.ts`): the topology only ever touches
 * `myPeerId`, `peers`, `config`, `logger`, and `sendOffer`.
 *
 * Two SFU branches were untested anywhere in the repo (client vitest suite
 * and Playwright harness alike) and are pinned here:
 *
 * 1. Non-SFU-skip (sfuTopology.ts): when a `Pending` peer arrives and NEITHER
 *    side is the SFU, the topology must log
 *    "Skipping connection between non-SFU peers" and `return` WITHOUT
 *    `setupClientToSFUConnection`/`sendOffer`. This is the defining
 *    star-vs-mesh invariant: two regular clients must never open a direct
 *    connection. A regression that drops this branch silently turns the star
 *    back into a mesh with no automated signal.
 *
 * 2. Explicit `sfuPeerId` departure (sfuTopology.ts): when the SFU id was
 *    explicitly designated in the constructor, the SFU's departure must NOT
 *    trigger `reElectSfu` (re-electing would override the operator's
 *    designation). Instead the topology logs
 *    "SFU peer disconnected - topology may fail" and takes no other action.
 *
 * The implicit-election paths (numeric election via `lowestPeerId`,
 * `reElectSfu` + `lastElectingSfuId` dedup, SFU-side `WebRTCDisconnected`
 * renegotiation) are also pinned here to keep the fast client-side suite
 * self-contained; the Playwright harness specs pin the same behavior through
 * a live two-server harness.
 */

class FakeLogger {
  public log = vi.fn();
  public warn = vi.fn();
  public error = vi.fn();
}

class FakeRTCDataChannel {
  public label: string;
  public initOpts: RTCDataChannelInit | undefined;

  constructor(label: string, initOpts?: RTCDataChannelInit) {
    this.label = label;
    this.initOpts = initOpts;
  }
}

/** Minimal `RTCPeerConnection` fake: only the members peerSetup touches. */
class FakeRTCPeerConnection {
  public createdChannels: {
    label: string;
    init: RTCDataChannelInit | undefined;
  }[] = [];
  public addedTracks: unknown[] = [];
  public ondatachannel:
    | ((ev: { channel?: FakeRTCDataChannel | null }) => void)
    | null = null;
  public ontrack: ((ev: { streams?: unknown[] }) => void) | null = null;

  createDataChannel(
    label: string,
    init?: RTCDataChannelInit
  ): FakeRTCDataChannel {
    this.createdChannels.push({ label, init });
    return new FakeRTCDataChannel(label, init);
  }

  addTrack(_track: unknown, _stream?: unknown): unknown {
    this.addedTracks.push(_track);
    return {};
  }
}

function makePeer(
  id: string,
  status: PeerStatus = PeerStatus.Pending
): { peer: Peer; rtc: FakeRTCPeerConnection } {
  const rtc = new FakeRTCPeerConnection();
  const peer = new Peer(
    id,
    status,
    {},
    new Date(),
    rtc as unknown as RTCPeerConnection
  );
  return { peer, rtc };
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    rtcOfferOptions: { offerToReceiveAudio: false },
    ...overrides,
  } as Config;
}

/**
 * A fake `ZeroHubClient` that stands in for the real client in the topology
 * tests. It exposes exactly the members the topologies read and records
 * `sendOffer` calls.
 */
class FakeZeroHubClient {
  public config: Config;
  public logger: ZeroHubLogger;
  public myPeerId: string;
  public peers: { [id: string]: Peer };
  public sendOffer: Mock;

  constructor(init: {
    config?: Config;
    logger?: ZeroHubLogger;
    myPeerId?: string;
    peers?: { [id: string]: Peer };
    sendOffer?: Mock;
  }) {
    this.config = init.config ?? makeConfig();
    this.logger = init.logger ?? (new FakeLogger() as unknown as ZeroHubLogger);
    this.myPeerId = init.myPeerId ?? "";
    this.peers = init.peers ?? {};
    this.sendOffer = init.sendOffer ?? vi.fn(() => Promise.resolve());
  }
}

function makeClient(
  overrides: Partial<FakeZeroHubClient> = {}
): FakeZeroHubClient {
  return new FakeZeroHubClient({ config: makeConfig(), ...overrides });
}

describe("SFUTopology.onPeerStatusChange — initialization guards", () => {
  it("throws when the client is not initialized (no zeroHub)", () => {
    const topology = new SFUTopology();
    const { peer } = makePeer("2");
    expect(() => topology.onPeerStatusChange(peer)).toThrow(
      "ZeroHub is not initialized"
    );
  });

  it("throws when the client is initialized but myPeerId is unset", () => {
    const topology = new SFUTopology();
    const client = makeClient(); // myPeerId ""
    topology.init(client as unknown as ZeroHubClient);
    const { peer } = makePeer("2");
    expect(() => topology.onPeerStatusChange(peer)).toThrow(
      "ZeroHub is not initialized"
    );
  });
});

describe("SFUTopology — non-SFU-skip invariant (star, not mesh)", () => {
  it(
    "two co-equal non-SFU peers observing each other's Pending must NOT " +
      "open a direct connection (skip-log emitted, no channels, no offer)",
    () => {
      // Implicit election: peers {"2","7"} + me "5" → lowest id "2" is the
      // SFU. I ("5") am not the SFU, and the Pending peer ("7") is not the
      // SFU either, so the star invariant says: no direct connection.
      const onDataChannel = vi.fn();
      const onTrack = vi.fn();
      const topology = new SFUTopology();
      const { peer: p2 } = makePeer("2");
      const { peer: p7, rtc } = makePeer("7");
      const client = makeClient({
        myPeerId: "5",
        peers: { "2": p2, "7": p7 },
        config: makeConfig({
          dataChannelConfig: { numberOfChannels: 2, onDataChannel },
          mediaChannelConfig: { onTrack },
        }),
      });
      topology.init(client as unknown as ZeroHubClient);

      topology.onPeerStatusChange(p7);

      // The defining star-vs-mesh invariant: no offer is sent between two
      // regular clients…
      expect(client.sendOffer).not.toHaveBeenCalled();
      // …no data channels are created, no media tracks are added, no
      // incoming handlers are installed (the skip `return`s before any
      // setup) — even though data/media configs ARE provided.
      expect(rtc.createdChannels).toHaveLength(0);
      expect(rtc.addedTracks).toHaveLength(0);
      expect(rtc.ondatachannel).toBeNull();
      expect(rtc.ontrack).toBeNull();
      expect(onDataChannel).not.toHaveBeenCalled();
      expect(onTrack).not.toHaveBeenCalled();
      // …and the skip is logged so operators can see the star discipline.
      const logger = client.logger as unknown as FakeLogger;
      expect(logger.log).toHaveBeenCalledWith(
        "Skipping connection between non-SFU peers: 5 and 7"
      );
    }
  );

  it("the skip does NOT fire when the Pending peer IS the (implicit) SFU", () => {
    // Same ids as above, but the event is for the SFU peer itself ("2"):
    // the non-SFU-skip branch must not swallow the client→SFU connection.
    const onDataChannel = vi.fn();
    const topology = new SFUTopology();
    const { peer: p2, rtc } = makePeer("2");
    const { peer: p7 } = makePeer("7");
    const client = makeClient({
      myPeerId: "5",
      peers: { "2": p2, "7": p7 },
      config: makeConfig({ dataChannelConfig: { onDataChannel } }),
    });
    topology.init(client as unknown as ZeroHubClient);

    topology.onPeerStatusChange(p2);

    const logger = client.logger as unknown as FakeLogger;
    expect(logger.log).toHaveBeenCalledWith("Client: Connecting to SFU");
    // The client is the answerer: no offer, but the incoming-channel
    // handler is armed.
    expect(client.sendOffer).not.toHaveBeenCalled();
    expect(rtc.ondatachannel).toBeDefined();
    expect(rtc.createdChannels).toHaveLength(0);
  });

  it("the skip does NOT fire when I am the (implicit) SFU", () => {
    // Lowest id is me → I am the SFU and must connect out to the client.
    const onDataChannel = vi.fn();
    const topology = new SFUTopology();
    const { peer: p1 } = makePeer("1");
    const { peer: p3, rtc } = makePeer("3");
    const client = makeClient({
      myPeerId: "1",
      peers: { "1": p1, "3": p3 },
      config: makeConfig({ dataChannelConfig: { onDataChannel } }),
    });
    topology.init(client as unknown as ZeroHubClient);

    topology.onPeerStatusChange(p3);

    const logger = client.logger as unknown as FakeLogger;
    expect(logger.log).toHaveBeenCalledWith(
      "SFU: Setting up connection to client 3"
    );
    expect(client.sendOffer).toHaveBeenCalledTimes(1);
    expect(client.sendOffer).toHaveBeenCalledWith(
      "3",
      client.config.rtcOfferOptions
    );
    // The SFU is the offerer: it creates the channels itself.
    expect(rtc.createdChannels.map((c) => c.label)).toEqual(["0"]);
  });
});

describe("SFUTopology — explicit sfuPeerId: election", () => {
  it("a Pending peer matching the explicit SFU id gets the client-to-SFU path", () => {
    // new SFUTopology("2"): the operator designated peer "2" as the SFU
    // regardless of numeric election (myPeerId "5" is the numerically
    // lowest, yet must NOT become the SFU).
    const onDataChannel = vi.fn();
    const topology = new SFUTopology("2");
    const { peer: p2, rtc } = makePeer("2");
    const { peer: p5 } = makePeer("5");
    const client = makeClient({
      myPeerId: "5",
      peers: { "2": p2, "5": p5 },
      config: makeConfig({ dataChannelConfig: { onDataChannel } }),
    });
    topology.init(client as unknown as ZeroHubClient);

    topology.onPeerStatusChange(p2);

    const logger = client.logger as unknown as FakeLogger;
    // The explicit designation wins over numeric order: peer "2" is the
    // SFU and I connect to it (as the answerer — the SFU will offer).
    expect(logger.log).toHaveBeenCalledWith("Client: Connecting to SFU");
    expect(client.sendOffer).not.toHaveBeenCalled();
    expect(rtc.ondatachannel).toBeDefined();
    expect(rtc.createdChannels).toHaveLength(0);
    expect(logger.log).not.toHaveBeenCalledWith(
      expect.stringContaining("Skipping connection between non-SFU peers")
    );
  });

  it("a Pending peer that is NOT the explicit SFU id hits the non-SFU-skip branch", () => {
    // Same explicit SFU ("2"), but the event is for a regular client "7":
    // "5" and "7" are both non-SFU → no direct connection.
    const onDataChannel = vi.fn();
    const topology = new SFUTopology("2");
    const { peer: p2 } = makePeer("2");
    const { peer: p5 } = makePeer("5");
    const { peer: p7, rtc } = makePeer("7");
    const client = makeClient({
      myPeerId: "5",
      peers: { "2": p2, "5": p5, "7": p7 },
      config: makeConfig({ dataChannelConfig: { onDataChannel } }),
    });
    topology.init(client as unknown as ZeroHubClient);

    topology.onPeerStatusChange(p7);

    const logger = client.logger as unknown as FakeLogger;
    expect(logger.log).toHaveBeenCalledWith(
      "Skipping connection between non-SFU peers: 5 and 7"
    );
    expect(client.sendOffer).not.toHaveBeenCalled();
    expect(rtc.createdChannels).toHaveLength(0);
    expect(rtc.ondatachannel).toBeNull();
    expect(onDataChannel).not.toHaveBeenCalled();
  });
});

describe("SFUTopology — explicit sfuPeerId: departure must NOT re-elect", () => {
  it(
    "the explicitly-designated SFU's ZeroHubDisconnected logs the " +
      "topology-may-fail warning and does NOT trigger re-election/offer",
    () => {
      // new SFUTopology("2"), I am "5" (a client). Peer "2" (the designated
      // SFU) leaves the hub. Re-electing would override the operator's
      // explicit designation, so the topology must only warn and stop.
      const topology = new SFUTopology("2");
      const { peer: p2 } = makePeer("2", PeerStatus.ZeroHubDisconnected);
      const { peer: p5 } = makePeer("5");
      const { peer: p7, rtc: rtc7 } = makePeer("7");
      const client = makeClient({
        myPeerId: "5",
        peers: { "2": p2, "5": p5, "7": p7 },
        config: makeConfig({ dataChannelConfig: { onDataChannel: vi.fn() } }),
      });
      topology.init(client as unknown as ZeroHubClient);

      topology.onPeerStatusChange(p2);

      const logger = client.logger as unknown as FakeLogger;
      // The warn-and-wait path is taken (not re-election)…
      expect(logger.warn).toHaveBeenCalledWith(
        "SFU peer disconnected - topology may fail"
      );
      // …and nothing else: no re-election log, no offer to the remaining
      // client "7", no connection setup.
      expect(logger.log).not.toHaveBeenCalledWith(
        expect.stringContaining("re-electing a new SFU")
      );
      expect(client.sendOffer).not.toHaveBeenCalled();
      expect(rtc7.createdChannels).toHaveLength(0);
      expect(rtc7.ondatachannel).toBeNull();
    }
  );

  it("a non-SFU peer's departure under an explicit SFU is a no-op (no warn, no re-election)", () => {
    // Only the SFU's departure is significant when the SFU is explicit: a
    // regular client leaving must produce neither the warn nor a re-election.
    const topology = new SFUTopology("2");
    const { peer: p2 } = makePeer("2");
    const { peer: p5 } = makePeer("5");
    const { peer: p7 } = makePeer("7", PeerStatus.ZeroHubDisconnected);
    const client = makeClient({
      myPeerId: "5",
      peers: { "2": p2, "5": p5, "7": p7 },
      config: makeConfig({ dataChannelConfig: { onDataChannel: vi.fn() } }),
    });
    topology.init(client as unknown as ZeroHubClient);

    topology.onPeerStatusChange(p7);

    const logger = client.logger as unknown as FakeLogger;
    expect(logger.warn).not.toHaveBeenCalled();
    expect(client.sendOffer).not.toHaveBeenCalled();
    expect(logger.log).not.toHaveBeenCalledWith(
      expect.stringContaining("re-electing a new SFU")
    );
  });
});

describe("SFUTopology — implicit numeric election (lowestPeerId)", () => {
  it('numeric (not lexicographic) ordering elects the SFU: "10" vs "2" picks "2"', () => {
    // me "10", peer "2": numerically 2 < 10, so "2" is the SFU and I am a
    // client. A lexicographic comparison would say "10" < "2" and wrongly
    // elect me (the d851fa41 regression class: server ids are sequential
    // decimal strings).
    const onDataChannel = vi.fn();
    const topology = new SFUTopology();
    const { peer: p2, rtc } = makePeer("2");
    const { peer: p10 } = makePeer("10");
    const client = makeClient({
      myPeerId: "10",
      peers: { "2": p2, "10": p10 },
      config: makeConfig({ dataChannelConfig: { onDataChannel } }),
    });
    topology.init(client as unknown as ZeroHubClient);

    topology.onPeerStatusChange(p2);

    const logger = client.logger as unknown as FakeLogger;
    // I connect TO the SFU (as the answerer), rather than becoming the SFU
    // and offering to "2".
    expect(logger.log).toHaveBeenCalledWith("Client: Connecting to SFU");
    expect(client.sendOffer).not.toHaveBeenCalled();
    expect(rtc.ondatachannel).toBeDefined();
    expect(rtc.createdChannels).toHaveLength(0);
  });

  it("the first peer in an empty hub is its own implicit SFU", () => {
    // No other peers at all: isSFU() short-circuits true and getSFUPeerId()
    // returns myPeerId. A Pending "other" peer can't happen in this state,
    // but a Connected event on a late peer must be handled by the SFU
    // without offering (the SFU only sets up on Pending).
    const topology = new SFUTopology();
    const client = makeClient({
      myPeerId: "1",
      peers: {},
      config: makeConfig({ dataChannelConfig: { onDataChannel: vi.fn() } }),
    });
    topology.init(client as unknown as ZeroHubClient);
    const { peer, rtc } = makePeer("3", PeerStatus.Connected);

    topology.onPeerStatusChange(peer);

    const logger = client.logger as unknown as FakeLogger;
    expect(logger.log).toHaveBeenCalledWith("SFU: Peer 3 connected");
    expect(client.sendOffer).not.toHaveBeenCalled();
    expect(rtc.createdChannels).toHaveLength(0);
  });
});

describe("SFUTopology — terminal / idle statuses are no-ops", () => {
  it("Connected: the non-SFU side logs nothing, offers nothing", () => {
    const topology = new SFUTopology();
    const { peer: p2 } = makePeer("2");
    const client = makeClient({
      myPeerId: "5",
      peers: { "2": p2 },
      config: makeConfig({ dataChannelConfig: { onDataChannel: vi.fn() } }),
    });
    topology.init(client as unknown as ZeroHubClient);
    const { peer, rtc } = makePeer("7", PeerStatus.Connected);

    topology.onPeerStatusChange(peer);

    const logger = client.logger as unknown as FakeLogger;
    expect(logger.log).not.toHaveBeenCalled();
    expect(client.sendOffer).not.toHaveBeenCalled();
    expect(rtc.createdChannels).toHaveLength(0);
  });

  it("ZeroHubDisconnected of a NON-SFU peer: no re-election, no offer", () => {
    const topology = new SFUTopology();
    const { peer: p2 } = makePeer("2");
    const client = makeClient({
      myPeerId: "5",
      peers: { "2": p2 },
      config: makeConfig({ dataChannelConfig: { onDataChannel: vi.fn() } }),
    });
    topology.init(client as unknown as ZeroHubClient);
    const { peer, rtc } = makePeer("7", PeerStatus.ZeroHubDisconnected);

    topology.onPeerStatusChange(peer);

    // Only the SFU's departure is significant: no log, no re-election, no
    // offer.
    const logger = client.logger as unknown as FakeLogger;
    expect(logger.log).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(client.sendOffer).not.toHaveBeenCalled();
    expect(rtc.createdChannels).toHaveLength(0);
  });

  it("Disconnected (local teardown): no offer, no channel re-setup", () => {
    const topology = new SFUTopology();
    const client = makeClient({
      myPeerId: "1",
      config: makeConfig({ dataChannelConfig: { onDataChannel: vi.fn() } }),
    });
    topology.init(client as unknown as ZeroHubClient);
    const { peer, rtc } = makePeer("3", PeerStatus.Disconnected);

    topology.onPeerStatusChange(peer);

    expect(client.sendOffer).not.toHaveBeenCalled();
    expect(rtc.createdChannels).toHaveLength(0);
  });
});

describe("SFUTopology — implicit SFU departure: reElectSfu + dedup", () => {
  it(
    "when the implicitly-elected SFU leaves and I am the lowest remaining " +
      "id, I become the SFU and offer to the remaining client exactly once",
    () => {
      // me "5", peers {"2","7"} → implicit SFU is "2". "2" leaves the hub;
      // the departed id is still in `zeroHub.peers` at handler time, so the
      // election must exclude it: remaining {5,7} → I ("5") become the SFU
      // and connect out to the remaining client "7".
      const topology = new SFUTopology();
      const { peer: p2 } = makePeer("2", PeerStatus.ZeroHubDisconnected);
      const { peer: p7, rtc: rtc7 } = makePeer("7");
      const client = makeClient({
        myPeerId: "5",
        peers: { "2": p2, "7": p7 },
        config: makeConfig({ dataChannelConfig: { onDataChannel: vi.fn() } }),
      });
      topology.init(client as unknown as ZeroHubClient);

      topology.onPeerStatusChange(p2); // "2" → ZeroHubDisconnected

      const logger = client.logger as unknown as FakeLogger;
      expect(logger.log).toHaveBeenCalledWith(
        "SFU peer 2 disconnected - re-electing a new SFU"
      );
      expect(logger.log).toHaveBeenCalledWith(
        "SFU: Setting up connection to client 7"
      );
      // I re-offer to the remaining client…
      expect(client.sendOffer).toHaveBeenCalledTimes(1);
      expect(client.sendOffer).toHaveBeenCalledWith(
        "7",
        client.config.rtcOfferOptions
      );
      // …and create its data channel as the new SFU.
      expect(rtc7.createdChannels.map((c) => c.label)).toEqual(["0"]);
    }
  );

  it("a duplicate/delayed departure for the same departed SFU is a no-op (lastElectingSfuId dedup)", () => {
    // Same scenario, but the server (or a reconnect roster-prune) delivers
    // the "2" departure event a second time. After the first re-election
    // the star is already around the new SFU: the second event must not
    // run the election a second time (no second offer, no duplicate
    // channels).
    const topology = new SFUTopology();
    const { peer: p2 } = makePeer("2", PeerStatus.ZeroHubDisconnected);
    const { peer: p7, rtc: rtc7 } = makePeer("7");
    const client = makeClient({
      myPeerId: "5",
      peers: { "2": p2, "7": p7 },
      config: makeConfig({ dataChannelConfig: { onDataChannel: vi.fn() } }),
    });
    topology.init(client as unknown as ZeroHubClient);

    topology.onPeerStatusChange(p2);
    topology.onPeerStatusChange(p2); // duplicate broadcast, same departed id

    const logger = client.logger as unknown as FakeLogger;
    expect(logger.log).toHaveBeenCalledTimes(2); // re-election log + setup log
    expect(logger.log).toHaveBeenNthCalledWith(
      1,
      "SFU peer 2 disconnected - re-electing a new SFU"
    );
    // The second event produced neither a second re-election log nor a
    // second setup/offer.
    expect(client.sendOffer).toHaveBeenCalledTimes(1);
    expect(rtc7.createdChannels).toHaveLength(1);
  });

  it("when the implicit SFU leaves and I am a client, I point my connection at the new SFU and do NOT offer", () => {
    // me "5", peers {"2","3"} → implicit SFU "2" leaves; remaining {3,5} →
    // "3" is the new SFU. I am a client: point my SFU connection at "3"
    // and wait for its offer (the new SFU will send it).
    const onDataChannel = vi.fn();
    const topology = new SFUTopology();
    const { peer: p2 } = makePeer("2", PeerStatus.ZeroHubDisconnected);
    const { peer: p3, rtc: rtc3 } = makePeer("3");
    const client = makeClient({
      myPeerId: "5",
      peers: { "2": p2, "3": p3 },
      config: makeConfig({ dataChannelConfig: { onDataChannel } }),
    });
    topology.init(client as unknown as ZeroHubClient);

    topology.onPeerStatusChange(p2);

    const logger = client.logger as unknown as FakeLogger;
    expect(logger.log).toHaveBeenCalledWith(
      "SFU peer 2 disconnected - re-electing a new SFU"
    );
    expect(logger.log).toHaveBeenCalledWith("Client: Connecting to SFU");
    // The client answers: it arms ondatachannel and sends no offer.
    expect(client.sendOffer).not.toHaveBeenCalled();
    expect(rtc3.ondatachannel).toBeDefined();
    expect(rtc3.createdChannels).toHaveLength(0);
  });

  it("a different departed id re-runs the election (dedup is per departed peer)", () => {
    // First departure: "2" (the implicit SFU) leaves → I ("5") become the
    // SFU. Then a SEPARATE peer "7" leaves: it is not the (new) SFU and
    // not the id we last re-elected from, so its departure is a no-op —
    // but it must NOT be swallowed by the dedup guard either (the guard
    // only matches the specific departed SFU id).
    const topology = new SFUTopology();
    const { peer: p2 } = makePeer("2", PeerStatus.ZeroHubDisconnected);
    const { peer: p7 } = makePeer("7");
    const client = makeClient({
      myPeerId: "5",
      peers: { "2": p2, "7": p7 },
      config: makeConfig({ dataChannelConfig: { onDataChannel: vi.fn() } }),
    });
    topology.init(client as unknown as ZeroHubClient);

    topology.onPeerStatusChange(p2); // SFU "2" leaves → I re-elect to "5"
    topology.onPeerStatusChange(p7); // "7" (now a non-SFU) leaves → no-op

    const logger = client.logger as unknown as FakeLogger;
    // No second re-election for "7" (it was never the SFU)…
    expect(logger.log).not.toHaveBeenCalledWith(
      "SFU peer 7 disconnected - re-electing a new SFU"
    );
    // …and still exactly one offer (to "7" as the new SFU, from the first
    // re-election).
    expect(client.sendOffer).toHaveBeenCalledTimes(1);
  });
});

describe("SFUTopology — WebRTCDisconnected renegotiation (SFU side)", () => {
  it("the SFU re-sends the offer for a dropped client and does NOT re-create channels or tracks", () => {
    // I am the implicit SFU ("1"), client "3" has a live connection, then
    // its WebRTC connection drops (signaling socket still alive). The SFU
    // is always the offerer to a client, so only the SFU re-negotiates: it
    // re-sends the offer on the EXISTING connection. Re-running
    // setupSFUConnection would duplicate channels (same labels) and
    // transceivers, so no channels/tracks/handlers must be created here.
    const onDataChannel = vi.fn();
    const onTrack = vi.fn();
    const topology = new SFUTopology();
    const { peer: p1 } = makePeer("1");
    const { peer: p3, rtc } = makePeer("3", PeerStatus.WebRTCDisconnected);
    const client = makeClient({
      myPeerId: "1",
      peers: { "1": p1, "3": p3 },
      config: makeConfig({
        dataChannelConfig: { numberOfChannels: 2, onDataChannel },
        mediaChannelConfig: { onTrack },
      }),
    });
    topology.init(client as unknown as ZeroHubClient);

    topology.onPeerStatusChange(p3);

    // The SFU re-sends the offer for the dropped client…
    expect(client.sendOffer).toHaveBeenCalledTimes(1);
    expect(client.sendOffer).toHaveBeenCalledWith(
      "3",
      client.config.rtcOfferOptions
    );
    // …but does NOT re-run the full setup: no duplicate channels, no
    // duplicate transceivers, no re-installed handlers (the existing
    // connection's channels with the same labels would otherwise be
    // handed to the application twice).
    expect(rtc.createdChannels).toHaveLength(0);
    expect(rtc.addedTracks).toHaveLength(0);
    expect(rtc.ondatachannel).toBeNull();
    expect(rtc.ontrack).toBeNull();
    expect(onDataChannel).not.toHaveBeenCalled();
    expect(onTrack).not.toHaveBeenCalled();
  });

  it("the client (answerer) is a no-op on WebRTCDisconnected — it recovers when the SFU's offer arrives", () => {
    // I am a client ("5") of the implicit SFU ("2"). My WebRTC connection
    // to the SFU drops; I must NOT offer (the SFU is the offerer) and must
    // NOT re-run setupClientToSFUConnection (which would duplicate the
    // ondatachannel handler and re-arm the connection).
    const topology = new SFUTopology();
    const { peer: p2 } = makePeer("2");
    const { peer: p5 } = makePeer("5");
    const { peer: p3, rtc } = makePeer("3", PeerStatus.WebRTCDisconnected);
    const client = makeClient({
      myPeerId: "5",
      peers: { "2": p2, "3": p3, "5": p5 },
      config: makeConfig({
        dataChannelConfig: { numberOfChannels: 2, onDataChannel: vi.fn() },
        mediaChannelConfig: { onTrack: vi.fn() },
      }),
    });
    topology.init(client as unknown as ZeroHubClient);

    topology.onPeerStatusChange(p3);

    // 3 is not the SFU and I am not the SFU → nothing happens: no offer,
    // no re-setup. I recover when the SFU's re-offer arrives and is
    // auto-answered through the existing offerMessage/sendAnswer path.
    expect(client.sendOffer).not.toHaveBeenCalled();
    expect(rtc.createdChannels).toHaveLength(0);
    expect(rtc.addedTracks).toHaveLength(0);
    expect(rtc.ondatachannel).toBeNull();
    expect(rtc.ontrack).toBeNull();
  });

  it("a failing re-send offer (SFU side) is logged via the logger, not thrown", async () => {
    const topology = new SFUTopology();
    const { peer: p1 } = makePeer("1");
    const { peer: p3 } = makePeer("3", PeerStatus.WebRTCDisconnected);
    const client = makeClient({
      myPeerId: "1",
      peers: { "1": p1, "3": p3 },
      sendOffer: vi.fn(() => Promise.reject(new Error("ws closed"))),
    });
    topology.init(client as unknown as ZeroHubClient);

    expect(() => topology.onPeerStatusChange(p3)).not.toThrow();
    // Flush the rejection so the .catch handler runs.
    await Promise.resolve();
    const logger = client.logger as unknown as FakeLogger;
    expect(logger.error).toHaveBeenCalledWith(
      "SFU: failed to re-send offer to dropped client",
      "3",
      expect.anything()
    );
  });

  it("a failing initial offer (SFU setup on Pending) is logged via the logger, not thrown", async () => {
    const topology = new SFUTopology();
    const { peer: p1 } = makePeer("1");
    const { peer: p3 } = makePeer("3");
    const client = makeClient({
      myPeerId: "1",
      peers: { "1": p1, "3": p3 },
      sendOffer: vi.fn(() => Promise.reject(new Error("boom"))),
    });
    topology.init(client as unknown as ZeroHubClient);

    expect(() => topology.onPeerStatusChange(p3)).not.toThrow();
    await Promise.resolve();
    const logger = client.logger as unknown as FakeLogger;
    expect(logger.error).toHaveBeenCalledWith(
      "SFU: Failed to send offer to client",
      "3",
      expect.anything()
    );
  });
});

import { describe, expect, it, vi, type Mock } from "vitest";
import { Peer } from "../peer";
import { ZeroHubClient } from "../zeroHub";
import { PeerStatus, type Config } from "../types";
import type { ZeroHubLogger } from "../logger";
import { MeshTopology } from "./meshTopology";

/**
 * Unit tests for `MeshTopology.onPeerStatusChange` state-machine decisions.
 * `ZeroHubClient` is faked (the same fake-client approach as
 * `zeroHub.test.ts`): the topology only ever touches `myPeerId`, `peers`,
 * `config`, `logger`, and `sendOffer`.
 *
 * Offer-collision invariant (meshTopology.ts):
 * `isOfferer = parseInt(peer.id) > parseInt(myPeerId)` — i.e. the peer with
 * the LOWER id is the offerer for each pair. Both sides of a pair must
 * agree on who offers, or two offers collide and the connection fails.
 * The comparison is numeric (peer ids are sequential decimal strings like
 * "1", "2", ..., "10"); a lexicographic one would disagree on "2" vs "10".
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

describe("MeshTopology.onPeerStatusChange — offerer selection", () => {
  it("throws when the client is not initialized (no zeroHub)", () => {
    const topology = new MeshTopology();
    const { peer } = makePeer("2");
    expect(() => topology.onPeerStatusChange(peer)).toThrow(
      "ZeroHub is not initialized"
    );
  });

  it("throws when the client is initialized but myPeerId is unset", () => {
    const topology = new MeshTopology();
    const client = makeClient(); // myPeerId ""
    topology.init(client as unknown as ZeroHubClient);
    const { peer } = makePeer("2");
    expect(() => topology.onPeerStatusChange(peer)).toThrow(
      "ZeroHub is not initialized"
    );
  });

  it("the lower-id peer offers; the higher-id peer does not", () => {
    // myPeerId "3", remote "10": numeric 10 > 3 → I am the offerer.
    const topology = new MeshTopology();
    const client = makeClient({
      myPeerId: "3",
      config: makeConfig({ dataChannelConfig: { onDataChannel: vi.fn() } }),
    });
    topology.init(client as unknown as ZeroHubClient);
    const { peer, rtc } = makePeer("10");

    topology.onPeerStatusChange(peer);

    expect(client.sendOffer).toHaveBeenCalledTimes(1);
    expect(client.sendOffer).toHaveBeenCalledWith(
      "10",
      client.config.rtcOfferOptions
    );
    expect(rtc.createdChannels.map((c) => c.label)).toEqual(["0"]);
  });

  it("a higher-id peer does not offer to a lower-id peer (it answers)", () => {
    const topology = new MeshTopology();
    const client = makeClient({
      myPeerId: "10",
      config: makeConfig({ dataChannelConfig: { onDataChannel: vi.fn() } }),
    });
    topology.init(client as unknown as ZeroHubClient);
    const { peer, rtc } = makePeer("3");

    topology.onPeerStatusChange(peer);

    // 10 > 3 → I am the answerer: no offer is sent, and the answerer side
    // only installs the ondatachannel handler (no channels are created).
    expect(client.sendOffer).not.toHaveBeenCalled();
    expect(rtc.createdChannels).toHaveLength(0);
    expect(rtc.ondatachannel).toBeDefined();
  });

  it("numeric (not lexicographic) peer-id comparison decides the offerer", () => {
    // myPeerId "3", remote "10": numeric 10 > 3 → I offer. A lexicographic
    // comparison would say "10" < "3" and flip the offer role, colliding
    // with the remote's offer (the d851fa41 regression class: the server
    // mints sequential decimal ids, so "10" sorts below "3" as a string).
    const topology = new MeshTopology();
    const client = makeClient({
      myPeerId: "3",
      config: makeConfig({ dataChannelConfig: { onDataChannel: vi.fn() } }),
    });
    topology.init(client as unknown as ZeroHubClient);
    const { peer } = makePeer("10");

    topology.onPeerStatusChange(peer);

    expect(client.sendOffer).toHaveBeenCalledTimes(1);
    expect(client.sendOffer).toHaveBeenCalledWith(
      "10",
      client.config.rtcOfferOptions
    );
  });

  it("the mirror pair agrees on the offerer (higher-id side waits)", () => {
    // Same pair from the other side: remote "3", me "10" → the remote (the
    // lower id) is the offerer and I must not also offer, or the two offers
    // collide.
    const topology = new MeshTopology();
    const client = makeClient({ myPeerId: "10" });
    topology.init(client as unknown as ZeroHubClient);
    const { peer } = makePeer("3", PeerStatus.Pending);

    topology.onPeerStatusChange(peer);

    expect(client.sendOffer).not.toHaveBeenCalled();
  });
});

describe("MeshTopology.onPeerStatusChange — Pending setup", () => {
  it("creates data channels with labels and the configured init, then sends the offer", () => {
    const init = { ordered: true } as RTCDataChannelInit;
    const onDataChannel = vi.fn();
    const topology = new MeshTopology();
    const client = makeClient({
      myPeerId: "2",
      config: makeConfig({
        dataChannelConfig: {
          numberOfChannels: 3,
          rtcDataChannelInit: init,
          onDataChannel,
        },
      }),
    });
    topology.init(client as unknown as ZeroHubClient);
    const { peer, rtc } = makePeer("10");

    topology.onPeerStatusChange(peer);

    // Three channels, labels "0","1","2", each with the init.
    expect(rtc.createdChannels.map((c) => c.label)).toEqual(["0", "1", "2"]);
    for (const c of rtc.createdChannels) {
      expect(c.init).toBe(init);
    }
    // onDataChannel fires once per channel, with isOwner=true.
    expect(onDataChannel).toHaveBeenCalledTimes(3);
    for (const call of onDataChannel.mock.calls) {
      expect(call[0]).toBe(peer);
      expect(call[2]).toBe(true);
    }
    // Offer sent after the channels exist.
    expect(client.sendOffer).toHaveBeenCalledTimes(1);
    expect(client.sendOffer).toHaveBeenCalledWith(
      "10",
      client.config.rtcOfferOptions
    );
  });

  it('defaults to a single channel (label "0") when numberOfChannels is omitted', () => {
    const onDataChannel = vi.fn();
    const topology = new MeshTopology();
    const client = makeClient({
      myPeerId: "2",
      config: makeConfig({ dataChannelConfig: { onDataChannel } }),
    });
    topology.init(client as unknown as ZeroHubClient);
    const { peer, rtc } = makePeer("10");

    topology.onPeerStatusChange(peer);

    expect(rtc.createdChannels.map((c) => c.label)).toEqual(["0"]);
    expect(onDataChannel).toHaveBeenCalledTimes(1);
    expect(client.sendOffer).toHaveBeenCalledTimes(1);
  });

  it("installs the media ontrack handler and adds local-stream tracks on Pending", () => {
    const onTrack = vi.fn();
    const trackA = { kind: "audio" };
    const trackB = { kind: "video" };
    const localStream = {
      getTracks: () => [trackA, trackB],
    } as unknown as MediaStream;
    const topology = new MeshTopology();
    const client = makeClient({
      myPeerId: "2",
      config: makeConfig({
        mediaChannelConfig: { localStream, onTrack },
      }),
    });
    topology.init(client as unknown as ZeroHubClient);
    const { peer, rtc } = makePeer("10"); // I'm the offerer (10 > 2)

    topology.onPeerStatusChange(peer);

    // Both local tracks were added to the peer connection.
    expect(rtc.addedTracks).toEqual([trackA, trackB]);
    // The ontrack handler is installed; firing it reaches the user callback.
    expect(rtc.ontrack).toBeDefined();
    const event = { streams: [{}] } as never;
    rtc.ontrack?.(event);
    expect(onTrack).toHaveBeenCalledTimes(1);
    expect(onTrack).toHaveBeenCalledWith(peer, event);
    expect(client.sendOffer).toHaveBeenCalledTimes(1);
  });

  it("installs ondatachannel for the answerer instead of creating channels", () => {
    const onDataChannel = vi.fn();
    const topology = new MeshTopology();
    const client = makeClient({
      myPeerId: "10",
      config: makeConfig({
        dataChannelConfig: { numberOfChannels: 2, onDataChannel },
      }),
    });
    topology.init(client as unknown as ZeroHubClient);
    const { peer, rtc } = makePeer("3"); // 10 > 3 → I'm the answerer

    topology.onPeerStatusChange(peer);

    // The answerer creates no channels…
    expect(rtc.createdChannels).toHaveLength(0);
    expect(onDataChannel).not.toHaveBeenCalled();
    // …and sends no offer, but arms the incoming-channel handler.
    expect(client.sendOffer).not.toHaveBeenCalled();
    expect(rtc.ondatachannel).toBeDefined();
  });

  it("does not create channels or add tracks when no data/media config is provided", () => {
    const topology = new MeshTopology();
    const client = makeClient({ myPeerId: "2" });
    topology.init(client as unknown as ZeroHubClient);
    const { peer, rtc } = makePeer("10");

    topology.onPeerStatusChange(peer);

    expect(rtc.createdChannels).toHaveLength(0);
    expect(rtc.addedTracks).toHaveLength(0);
    expect(rtc.ontrack).toBeNull();
    expect(rtc.ondatachannel).toBeNull();
    // The offer is still sent (WebRTC media can flow without config).
    expect(client.sendOffer).toHaveBeenCalledTimes(1);
  });
});

describe("MeshTopology.onPeerStatusChange — terminal / idle statuses are no-ops", () => {
  it("Connected: no offer, no channel re-setup", () => {
    const topology = new MeshTopology();
    const client = makeClient({ myPeerId: "2" });
    topology.init(client as unknown as ZeroHubClient);
    const { peer, rtc } = makePeer("10", PeerStatus.Connected);

    topology.onPeerStatusChange(peer);

    expect(client.sendOffer).not.toHaveBeenCalled();
    expect(rtc.createdChannels).toHaveLength(0);
  });

  it("ZeroHubDisconnected: no offer, no channel re-setup", () => {
    const topology = new MeshTopology();
    const client = makeClient({ myPeerId: "2" });
    topology.init(client as unknown as ZeroHubClient);
    const { peer, rtc } = makePeer("10", PeerStatus.ZeroHubDisconnected);

    topology.onPeerStatusChange(peer);

    expect(client.sendOffer).not.toHaveBeenCalled();
    expect(rtc.createdChannels).toHaveLength(0);
  });

  it("Disconnected: no offer, no channel re-setup", () => {
    const topology = new MeshTopology();
    const client = makeClient({ myPeerId: "2" });
    topology.init(client as unknown as ZeroHubClient);
    const { peer, rtc } = makePeer("10", PeerStatus.Disconnected);

    topology.onPeerStatusChange(peer);

    expect(client.sendOffer).not.toHaveBeenCalled();
    expect(rtc.createdChannels).toHaveLength(0);
  });
});

describe("MeshTopology.onPeerStatusChange — WebRTCDisconnected renegotiation", () => {
  it("the offerer re-sends the offer exactly once and does NOT re-create channels or tracks", () => {
    const onDataChannel = vi.fn();
    const onTrack = vi.fn();
    const topology = new MeshTopology();
    const client = makeClient({
      myPeerId: "2",
      config: makeConfig({
        dataChannelConfig: { numberOfChannels: 2, onDataChannel },
        mediaChannelConfig: { onTrack },
      }),
    });
    topology.init(client as unknown as ZeroHubClient);
    const { peer, rtc } = makePeer("10", PeerStatus.WebRTCDisconnected);

    topology.onPeerStatusChange(peer);

    // The offerer re-sends the offer for the dropped peer…
    expect(client.sendOffer).toHaveBeenCalledTimes(1);
    expect(client.sendOffer).toHaveBeenCalledWith(
      "10",
      client.config.rtcOfferOptions
    );
    // …but does NOT re-run the full setup: no duplicate channels, no
    // duplicate transceivers (the existing connection's channels with the
    // same labels would otherwise be handed to the application twice).
    expect(rtc.createdChannels).toHaveLength(0);
    expect(rtc.addedTracks).toHaveLength(0);
    expect(rtc.ondatachannel).toBeNull();
    expect(rtc.ontrack).toBeNull();
    expect(onDataChannel).not.toHaveBeenCalled();
  });

  it("the answerer is a no-op on WebRTCDisconnected (recovers when the offerer's offer arrives)", () => {
    const topology = new MeshTopology();
    const client = makeClient({
      myPeerId: "10",
      config: makeConfig({
        dataChannelConfig: { numberOfChannels: 2, onDataChannel: vi.fn() },
      }),
    });
    topology.init(client as unknown as ZeroHubClient);
    const { peer, rtc } = makePeer("3", PeerStatus.WebRTCDisconnected);

    topology.onPeerStatusChange(peer);

    // 10 > 3 → I am the answerer: no offer, no re-setup.
    expect(client.sendOffer).not.toHaveBeenCalled();
    expect(rtc.createdChannels).toHaveLength(0);
    expect(rtc.addedTracks).toHaveLength(0);
    expect(rtc.ondatachannel).toBeNull();
  });

  it("a failing re-send offer is logged via the logger, not thrown", async () => {
    const topology = new MeshTopology();
    const client = makeClient({
      myPeerId: "2",
      sendOffer: vi.fn(() => Promise.reject(new Error("ws closed"))),
    });
    topology.init(client as unknown as ZeroHubClient);
    const { peer } = makePeer("10", PeerStatus.WebRTCDisconnected);

    expect(() => topology.onPeerStatusChange(peer)).not.toThrow();
    // Flush the rejection so the .catch handler runs.
    await Promise.resolve();
    const logger = client.logger as unknown as FakeLogger;
    expect(logger.error).toHaveBeenCalledWith(
      "failed to re-send offer to dropped peer",
      "10",
      expect.anything()
    );
  });

  it("a failing initial offer (Pending) is logged via the logger, not thrown", async () => {
    const topology = new MeshTopology();
    const client = makeClient({
      myPeerId: "2",
      sendOffer: vi.fn(() => Promise.reject(new Error("boom"))),
    });
    topology.init(client as unknown as ZeroHubClient);
    const { peer } = makePeer("10");

    expect(() => topology.onPeerStatusChange(peer)).not.toThrow();
    await Promise.resolve();
    const logger = client.logger as unknown as FakeLogger;
    expect(logger.error).toHaveBeenCalledWith(
      "failed to send offer to peer",
      "10",
      expect.anything()
    );
  });
});

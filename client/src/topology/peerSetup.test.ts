import { describe, expect, it, vi } from "vitest";
import { Peer } from "../peer";
import { PeerStatus, type Config } from "../types";
import type { ZeroHubLogger } from "../logger";
import { setupDataChannel, setupMediaChannel } from "./peerSetup";

/**
 * Unit tests for the shared channel-setup helpers in `peerSetup.ts`.
 * `RTCPeerConnection` is faked (the Node environment has no WebRTC); the
 * helpers only ever call `createDataChannel`, `addTrack`, and install the
 * `ondatachannel`/`ontrack` handlers.
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

class FakeRTCPeerConnection {
  public createdChannels: {
    label: string;
    init: RTCDataChannelInit | undefined;
  }[] = [];
  public addedTracks: { track: unknown; stream: unknown }[] = [];
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

  addTrack(track: unknown, stream?: unknown): unknown {
    this.addedTracks.push({ track, stream });
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

describe("setupDataChannel — offerer", () => {
  it("creates numberOfChannels labeled channels and fires onDataChannel with isOwner=true per channel", () => {
    const logger = new FakeLogger();
    const onDataChannel = vi.fn();
    const init = { ordered: true } as RTCDataChannelInit;
    const { peer, rtc } = makePeer("5");

    setupDataChannel(
      makeConfig({
        dataChannelConfig: {
          numberOfChannels: 3,
          rtcDataChannelInit: init,
          onDataChannel,
        },
      }),
      peer,
      logger as unknown as ZeroHubLogger,
      true
    );

    // Channels "0","1","2" created in order, each with the shared init.
    expect(rtc.createdChannels.map((c) => c.label)).toEqual(["0", "1", "2"]);
    for (const c of rtc.createdChannels) {
      expect(c.init).toBe(init);
    }
    // The user callback fires once per channel with isOwner=true and the
    // created channel (so the app can wire onopen/onmessage).
    expect(onDataChannel).toHaveBeenCalledTimes(3);
    expect(onDataChannel.mock.calls[0][0]).toBe(peer);
    expect((onDataChannel.mock.calls[0][1] as { label: string }).label).toBe(
      "0"
    );
    expect(onDataChannel.mock.calls[0][2]).toBe(true);
    expect(onDataChannel.mock.calls[2][2]).toBe(true);
    // The offerer does not install an ondatachannel handler.
    expect(rtc.ondatachannel).toBeNull();
  });

  it('creates a single channel labeled "0" when numberOfChannels is omitted', () => {
    const logger = new FakeLogger();
    const onDataChannel = vi.fn();
    const { peer, rtc } = makePeer("5");

    setupDataChannel(
      makeConfig({ dataChannelConfig: { onDataChannel } }),
      peer,
      logger as unknown as ZeroHubLogger,
      true
    );

    expect(rtc.createdChannels.map((c) => c.label)).toEqual(["0"]);
    expect(onDataChannel).toHaveBeenCalledTimes(1);
  });
});

describe("setupDataChannel — answerer", () => {
  it("installs ondatachannel and fires onDataChannel with isOwner=false for each incoming channel", () => {
    const logger = new FakeLogger();
    const onDataChannel = vi.fn();
    const logOnDataChannel = vi.fn();
    const { peer, rtc } = makePeer("5");

    setupDataChannel(
      makeConfig({ dataChannelConfig: { onDataChannel } }),
      peer,
      logger as unknown as ZeroHubLogger,
      false,
      logOnDataChannel
    );

    expect(rtc.ondatachannel).toBeDefined();
    expect(rtc.createdChannels).toHaveLength(0);

    const channel = new FakeRTCDataChannel("0");
    rtc.ondatachannel?.({ channel });
    expect(logOnDataChannel).toHaveBeenCalledTimes(1);
    expect(onDataChannel).toHaveBeenCalledTimes(1);
    expect(onDataChannel.mock.calls[0][0]).toBe(peer);
    expect(onDataChannel.mock.calls[0][1]).toBe(channel);
    expect(onDataChannel.mock.calls[0][2]).toBe(false);
  });

  it("an event with no channel does not invoke the user callback", () => {
    const logger = new FakeLogger();
    const onDataChannel = vi.fn();
    const { peer, rtc } = makePeer("5");

    setupDataChannel(
      makeConfig({ dataChannelConfig: { onDataChannel } }),
      peer,
      logger as unknown as ZeroHubLogger,
      false
    );

    rtc.ondatachannel?.({ channel: null });
    rtc.ondatachannel?.({} as { channel?: FakeRTCDataChannel | null });
    expect(onDataChannel).not.toHaveBeenCalled();
  });

  it("a throwing user onDataChannel does not escape the ondatachannel handler and keeps delivering later events", () => {
    const logger = new FakeLogger();
    const seen: string[] = [];
    const { peer, rtc } = makePeer("5");

    setupDataChannel(
      makeConfig({
        dataChannelConfig: {
          onDataChannel: (_p, dc) => {
            seen.push(dc.label);
            if (seen.length === 1) {
              throw new Error("user channel boom");
            }
          },
        },
      }),
      peer,
      logger as unknown as ZeroHubLogger,
      false
    );

    // First event throws; nothing escapes the handler…
    expect(() =>
      rtc.ondatachannel?.({ channel: new FakeRTCDataChannel("0") })
    ).not.toThrow();
    expect(logger.error).toHaveBeenCalledWith(
      "onDataChannel handler threw",
      expect.anything()
    );
    // …and the second event still reaches the user callback.
    expect(() =>
      rtc.ondatachannel?.({ channel: new FakeRTCDataChannel("1") })
    ).not.toThrow();
    expect(seen).toEqual(["0", "1"]);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});

describe("setupDataChannel — no config", () => {
  it("no dataChannelConfig: no channels created and no handler installed", () => {
    const logger = new FakeLogger();
    const { peer, rtc } = makePeer("5");

    setupDataChannel(
      makeConfig(),
      peer,
      logger as unknown as ZeroHubLogger,
      true
    );
    expect(rtc.createdChannels).toHaveLength(0);
    expect(rtc.ondatachannel).toBeNull();

    setupDataChannel(
      makeConfig(),
      peer,
      logger as unknown as ZeroHubLogger,
      false
    );
    expect(rtc.ondatachannel).toBeNull();
  });

  it("dataChannelConfig without onDataChannel is treated as not configured", () => {
    const logger = new FakeLogger();
    const { peer, rtc } = makePeer("5");

    setupDataChannel(
      makeConfig({ dataChannelConfig: { numberOfChannels: 2 } as never }),
      peer,
      logger as unknown as ZeroHubLogger,
      true
    );
    expect(rtc.createdChannels).toHaveLength(0);
    expect(rtc.ondatachannel).toBeNull();
  });
});

describe("setupMediaChannel", () => {
  it("adds every localStream track with the stream and fires logOnAddTrack per track", () => {
    const logger = new FakeLogger();
    const onTrack = vi.fn();
    const logOnAddTrack = vi.fn();
    const trackA = { kind: "audio" };
    const trackB = { kind: "video" };
    const localStream = {
      getTracks: () => [trackA, trackB],
    } as unknown as MediaStream;
    const { peer, rtc } = makePeer("5");

    setupMediaChannel(
      makeConfig({
        mediaChannelConfig: {
          localStream,
          onTrack,
        },
      }),
      peer,
      logger as unknown as ZeroHubLogger,
      logOnAddTrack
    );

    // The connection receives every track of the local stream, with the
    // stream itself (not a copy) as the stream argument.
    expect(rtc.addedTracks).toEqual([
      { track: trackA, stream: localStream },
      { track: trackB, stream: localStream },
    ]);
    expect(logOnAddTrack).toHaveBeenCalledTimes(2);
    expect(logOnAddTrack).toHaveBeenCalledWith(logger, peer);
  });

  it("fires onTrack for incoming track events", () => {
    const logger = new FakeLogger();
    const onTrack = vi.fn();
    const { peer, rtc } = makePeer("5");

    setupMediaChannel(
      makeConfig({ mediaChannelConfig: { onTrack } }),
      peer,
      logger as unknown as ZeroHubLogger
    );

    const event = { streams: [{ id: "remote" }] } as never;
    expect(rtc.ontrack).toBeDefined();
    rtc.ontrack?.(event);
    expect(onTrack).toHaveBeenCalledTimes(1);
    expect(onTrack).toHaveBeenCalledWith(peer, event);
  });

  it("fires logOnTrack before onTrack for each incoming event", () => {
    const logger = new FakeLogger();
    const onTrack = vi.fn();
    const logOnTrack = vi.fn();
    const { peer, rtc } = makePeer("5");

    setupMediaChannel(
      makeConfig({ mediaChannelConfig: { onTrack } }),
      peer,
      logger as unknown as ZeroHubLogger,
      undefined,
      logOnTrack
    );

    rtc.ontrack?.({} as never);
    expect(logOnTrack).toHaveBeenCalledTimes(1);
    expect(logOnTrack).toHaveBeenCalledWith(logger, peer);
    expect(onTrack).toHaveBeenCalledTimes(1);
  });

  it("a throwing mediaChannelConfig.onTrack does not escape the ontrack handler and keeps delivering later events", () => {
    const logger = new FakeLogger();
    const seen: number[] = [];
    const { peer, rtc } = makePeer("5");

    setupMediaChannel(
      makeConfig({
        mediaChannelConfig: {
          onTrack: () => {
            seen.push(1);
            if (seen.length === 1) {
              throw new Error("user track boom");
            }
          },
        },
      }),
      peer,
      logger as unknown as ZeroHubLogger
    );

    expect(() => rtc.ontrack?.({} as never)).not.toThrow();
    expect(logger.error).toHaveBeenCalledWith(
      "onTrack handler threw",
      expect.anything()
    );
    expect(() => rtc.ontrack?.({} as never)).not.toThrow();
    expect(seen).toEqual([1, 1]);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("no mediaChannelConfig: no tracks added and no ontrack handler installed", () => {
    const logger = new FakeLogger();
    const { peer, rtc } = makePeer("5");

    setupMediaChannel(makeConfig(), peer, logger as unknown as ZeroHubLogger);

    expect(rtc.addedTracks).toHaveLength(0);
    expect(rtc.ontrack).toBeNull();
  });

  it("mediaChannelConfig without a localStream adds no tracks but still installs ontrack", () => {
    const logger = new FakeLogger();
    const onTrack = vi.fn();
    const { peer, rtc } = makePeer("5");

    setupMediaChannel(
      makeConfig({ mediaChannelConfig: { onTrack } }),
      peer,
      logger as unknown as ZeroHubLogger
    );

    expect(rtc.addedTracks).toHaveLength(0);
    expect(rtc.ontrack).toBeDefined();
    rtc.ontrack?.({} as never);
    expect(onTrack).toHaveBeenCalledTimes(1);
  });
});

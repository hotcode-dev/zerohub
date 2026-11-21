import { vi } from "vitest";
import { Peer } from "../../peer";
import { PeerStatus } from "../../types";

/**
 * Shared WebRTC test fakes for the topology unit tests.
 *
 * These were previously copy-pasted verbatim into `meshTopology.test.ts`,
 * `peerSetup.test.ts`, and `sfuTopology.test.ts`. Keeping them in one module
 * stops the fakes drifting apart — the `addedTracks` shape had already diverged
 * between the files before this extraction.
 *
 * `addedTracks` records `{ track, stream }` pairs (the richer of the three
 * original shapes). Tests that only assert `.length` on it are unaffected.
 */

/** Minimal logger fake exposing the members the topology code calls. */
export class FakeLogger {
  public log = vi.fn();
  public warn = vi.fn();
  public error = vi.fn();
}

export class FakeRTCDataChannel {
  public label: string;
  public initOpts: RTCDataChannelInit | undefined;

  constructor(label: string, initOpts?: RTCDataChannelInit) {
    this.label = label;
    this.initOpts = initOpts;
  }
}

/** Minimal `RTCPeerConnection` fake: only the members peerSetup touches. */
export class FakeRTCPeerConnection {
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

export function makePeer(
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

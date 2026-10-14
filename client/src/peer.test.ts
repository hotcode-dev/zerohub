import { describe, expect, it } from "vitest";
import { Peer } from "./peer";
import { PeerStatus } from "./types";

/**
 * Minimal RTCPeerConnection stub: only the surface Peer.close() touches.
 */
class FakeRTCConnection {
  closeCalls = 0;
  close() {
    this.closeCalls += 1;
  }
}

function makePeer(id: string): Peer {
  return new Peer(
    id,
    PeerStatus.Pending,
    { name: id },
    new Date("2026-01-01T00:00:00Z"),
    new FakeRTCConnection() as unknown as RTCPeerConnection
  );
}

describe("Peer", () => {
  it("stores id, status, metadata, joinTime and the rtc connection", () => {
    const peer = makePeer("1");
    expect(peer.id).toBe("1");
    expect(peer.status).toBe(PeerStatus.Pending);
    expect(peer.metadata).toEqual({ name: "1" });
    expect(peer.joinTime.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("supports status transitions through the peer lifecycle", () => {
    const peer = makePeer("1");
    peer.status = PeerStatus.Offering;
    expect(peer.status).toBe(PeerStatus.Offering);
    peer.status = PeerStatus.Answering;
    expect(peer.status).toBe(PeerStatus.Answering);
    peer.status = PeerStatus.Connected;
    expect(peer.status).toBe(PeerStatus.Connected);
    peer.status = PeerStatus.Disconnected;
    expect(peer.status).toBe(PeerStatus.Disconnected);
  });

  it("close() delegates to the underlying RTC connection on every call", () => {
    const peer = makePeer("1");
    const rtc = peer.rtcConn as unknown as FakeRTCConnection;
    peer.close();
    peer.close();
    expect(rtc.closeCalls).toBe(2);
  });
});

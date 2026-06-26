/**
 * Test: Memory leak fix for RTCPeerConnection on peer disconnect
 *
 * Verifies that when a peer is disconnected, the RTCPeerConnection
 * is properly closed and cleaned up — no orphaned connections remain.
 *
 * Uses a minimal RTCPeerConnection mock compatible with bun:test.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { ZeroHubClient } from "./zeroHub";
import { Peer } from "./peer";
import { PeerStatus } from "./types";

// Minimal RTCPeerConnection mock that tracks close() calls and state
class MockRTCPeerConnection {
  closed = false;
  connectionState: string = "connected";
  iceConnectionState: string = "new";
  localDescription: RTCSessionDescription | null = null;
  readonly senders: RTCRtpSender[] = [];
  onconnectionstatechange: ((ev: Event) => void) | null = null;
  oniceconnectionstatechange: ((ev: Event) => void) | null = null;
  ontrack: ((event: RTCTrackEvent) => void) | null = null;
  ondatachannel: ((event: RTCDataChannelEvent) => void) | null = null;
  onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;
  canTrickleIceCandidates: boolean | null = null;
  currentLocalDescription: RTCSessionDescription | null = null;
  currentRemoteDescription: RTCSessionDescription | null = null;
  iceGatheringState: string = "new";
  localStreams: MediaStream[] = [];
  remoteStreams: MediaStream[] = [];
  addStream() {}
  removeStream() {}
  addTrack() { return {} as RTCRtpSender; }
  removeTrack() {}
  getTransceivers() { return []; }
  addTransceiver() { return {} as RTCRtpTransceiver; }
  close() {
    this.closed = true;
    this.connectionState = "closed";
  }
  createDataChannel() {
    return {} as RTCDataChannel;
  }
  getSenders() {
    return this.senders;
  }
  getReceivers() {
    return [];
  }
  getStats() {
    return Promise.resolve({} as RTCStatsReport);
  }
  restartIce() {}
  setConfiguration() {}
  async setLocalDescription() {}
  async setRemoteDescription() {}
  createOffer() {
    return Promise.resolve({} as RTCSessionDescription);
  }
  createAnswer() {
    return Promise.resolve({} as RTCSessionDescription);
  }
}

// Mock RTCPeerConnection in global scope for the client module
(globalThis as any).RTCPeerConnection = MockRTCPeerConnection;

// Helper to create a mock peer connection
function mockConn(): RTCPeerConnection {
  return new MockRTCPeerConnection() as any;
}

// Helper to cast rtcConn to our mock type
function asMock(conn: RTCPeerConnection): any {
  return conn as any;
}

describe("zeroHub-leak", () => {
  let client: ZeroHubClient<object, object>;

  beforeEach(() => {
    client = new ZeroHubClient<object, object>(["localhost:8080"], {
      tls: false,
    });
  });

  describe("disconnectPeer", () => {
    it("closes RTCPeerConnection when peer disconnects", () => {
      // Set up a fake hub context
      (client as any).myPeerId = "1";
      (client as any).hubInfo = { id: "test-hub", createTime: new Date() };

      // Add a peer with an RTCPeerConnection
      const peerId = "2";
      const peer = new Peer(
        peerId,
        PeerStatus.Pending,
        {},
        new Date(),
        mockConn()
      );
      client.peers[peerId] = peer;

      const rtcConn = peer.rtcConn;

      // Trigger disconnect
      (client as any).disconnectPeer(peerId);

      // RTCPeerConnection should be closed
      expect(asMock(rtcConn).closed).toBe(true);
    });

    it("removes peer from this.peers map", () => {
      // Set up a fake hub context
      (client as any).myPeerId = "1";
      (client as any).hubInfo = { id: "test-hub", createTime: new Date() };

      const peerId = "3";
      const peer = new Peer(
        peerId,
        PeerStatus.Pending,
        {},
        new Date(),
        mockConn()
      );
      client.peers[peerId] = peer;

      (client as any).disconnectPeer(peerId);

      expect(client.peers[peerId]).toBeUndefined();
    });

    it("does nothing for unknown peer", () => {
      // Should not throw
      expect(() => {
        (client as any).disconnectPeer("nonexistent");
      }).not.toThrow();
    });

    it("closes RTCPeerConnection when peerDisconnectedMessage arrives", () => {
      // Set up a fake hub context
      (client as any).myPeerId = "1";
      (client as any).hubInfo = { id: "test-hub", createTime: new Date() };

      const peerId = "4";
      const peer = new Peer(
        peerId,
        PeerStatus.Pending,
        {},
        new Date(),
        mockConn()
      );
      client.peers[peerId] = peer;

      // Create a mock peerDisconnectedMessage
      const serverMessage = {
        peerDisconnectedMessage: {
          peerId,
        },
      };

      (client as any).handleZeroHubMessage(serverMessage);

      expect(asMock(peer.rtcConn).closed).toBe(true);
      expect(client.peers[peerId]).toBeUndefined();
    });

    it("peerJoinedMessage closes old RTCPeerConnection during reconnection", () => {
      // Set up a fake hub context
      (client as any).myPeerId = "1";
      (client as any).hubInfo = { id: "test-hub", createTime: new Date() };

      const peerId = "5";
      const peer = new Peer(
        peerId,
        PeerStatus.Pending,
        {},
        new Date(),
        mockConn()
      );
      client.peers[peerId] = peer;

      const oldConn = peer.rtcConn;

      // Simulate peerJoinedMessage with same peerId (reconnection)
      const serverMessage = {
        peerJoinedMessage: {
          peer: {
            id: peerId,
            metadata: JSON.stringify({}),
            joinTime: new Date(),
          },
        },
      };

      (client as any).handleZeroHubMessage(serverMessage);

      // Old connection should be closed
      expect(asMock(oldConn).closed).toBe(true);
      // New peer should have a new connection
      expect(client.peers[peerId]).toBeDefined();
      expect(asMock((client.peers[peerId]! as any).rtcConn)).not.toBe(oldConn);
    });

    it("handles multiple disconnects without error", () => {
      (client as any).myPeerId = "1";
      (client as any).hubInfo = { id: "test-hub", createTime: new Date() };

      const peerId = "6";
      const peer = new Peer(
        peerId,
        PeerStatus.Pending,
        {},
        new Date(),
        mockConn()
      );
      client.peers[peerId] = peer;

      // First disconnect
      (client as any).disconnectPeer(peerId);
      expect(asMock(peer.rtcConn).closed).toBe(true);

      // Second disconnect (idempotent)
      expect(() => {
        (client as any).disconnectPeer(peerId);
      }).not.toThrow();
    });

    it("peerDisconnectedMessage triggers updatePeerStatus", () => {
      // Set up a fake hub context
      (client as any).myPeerId = "1";
      (client as any).hubInfo = { id: "test-hub", createTime: new Date() };

      const peerId = "7";
      const peer = new Peer(
        peerId,
        PeerStatus.Pending,
        {},
        new Date(),
        mockConn()
      );
      client.peers[peerId] = peer;

      let statusChanged = false;
      let receivedStatus: PeerStatus | undefined;
      (client as any).onPeerStatusChange = (p: Peer) => {
        statusChanged = true;
        receivedStatus = p.status;
      };

      const serverMessage = {
        peerDisconnectedMessage: {
          peerId,
        },
      };

      (client as any).handleZeroHubMessage(serverMessage);

      expect(statusChanged).toBe(true);
      expect(receivedStatus).toBe(PeerStatus.ZeroHubDisconnected);
    });
  });
});

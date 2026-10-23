import { test, expect, Page } from "@playwright/test";
import { prepareUnitHarnessPage } from "./utils/unit-harness";

/**
 * Unit tests for P2P WebRTC drop recovery: when a peer's P2P connection drops
 * (`RTCPeerConnection` reports `disconnected` / ICE `failed`) while the
 * signaling socket stays alive, the client must re-negotiate over the intact
 * signaling socket instead of going silent forever (the previous behaviour:
 * a bare `restartIce()` whose new ICE ufrag no remote peer could learn, and
 * no topology reaction to `PeerStatus.WebRTCDisconnected`).
 *
 * The recovery is debounced (private `WEBRTC_RECOVERY_DELAY_MS`, 500ms —
 * specs outlast it with a real-time in-page wait) and funnels both drop
 * signals (`disconnected`, ICE `failed`) through a single per-peer timer, so
 * rapid flaps coalesce into exactly one re-negotiation.
 *
 * Driven through the unit harness (mocked `RTCPeerConnection`, real
 * `MeshTopology` / `SFUTopology` instances, no server, no real WebRTC stack).
 * "Re-establishment" in this harness means: the offerer's fresh offer
 * actually goes out over the (stubbed) signaling socket, the peer's status
 * log shows the `webrtc_disconnected` transition, and the peer transitions
 * back to `connected` once the remote side answers and the link recovers.
 *
 * Role note: the collision-free offer role is the topology's existing
 * `isOfferer` logic — in mesh, the client whose own id is LOWER than the
 * peer's id offers (`parseInt(peer.id) > parseInt(myPeerId)`); in SFU, the
 * SFU (lowest id in the hub) always offers. The ids below are chosen so each
 * test lands on the side being asserted.
 */

type Send = {
  kind: "offer" | "answer" | "iceCandidate";
  peerId: string;
  sdp?: string;
  candidate?: string;
};

/** The in-page driver surface (window.ZeroHubUnitHarness). */

/** Thin serializable wrappers over the in-page driver. */
function driver(page: Page) {
  return {
    createClientWithTopology: (topology: "mesh" | "sfu") =>
      page.evaluate(
        (t) => ZeroHubUnitHarness.createClientWithTopology(t),
        topology,
      ),
    sendHubInfo: (id: number, myPeerId: string, peerIds: string[]) =>
      page.evaluate(
        ([id, myPeerId, peerIds]) =>
          ZeroHubUnitHarness.sendHubInfo(id, myPeerId, peerIds),
        [id, myPeerId, peerIds] as const,
      ),
    setConnectionState: (id: number, peerId: string, state: string) =>
      page.evaluate(
        ([id, peerId, state]) =>
          ZeroHubUnitHarness.setConnectionState(id, peerId, state),
        [id, peerId, state] as const,
      ),
    setIceState: (id: number, peerId: string, state: string) =>
      page.evaluate(
        ([id, peerId, state]) => ZeroHubUnitHarness.setIceState(id, peerId, state),
        [id, peerId, state] as const,
      ),
    setPeerRemoteDescription: (id: number, peerId: string, type: string) =>
      page.evaluate(
        ([id, peerId, type]) =>
          ZeroHubUnitHarness.setPeerRemoteDescription(id, peerId, type),
        [id, peerId, type] as const,
      ),
    webrtcRecoveryEntries: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.webrtcRecoveryEntries(id), id),
    recordStatusChanges: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.recordStatusChanges(id), id),
    drainStatusChanges: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.drainStatusChanges(id), id),
    stubSocket: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.stubSocket(id), id),
    setWaitIceTimeout: (id: number, ms: number) =>
      page.evaluate(
        ([id, ms]) => ZeroHubUnitHarness.setWaitIceTimeout(id, ms),
        [id, ms] as const,
      ),
    drainSends: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.drainSends(id), id),
    getPeerStatus: (id: number, peerId: string) =>
      page.evaluate(([id, peerId]) => ZeroHubUnitHarness.getPeerStatus(id, peerId), [
        id,
        peerId,
      ] as const),
    sendOfferMessage: (id: number, offerPeerId: string, offerSdp: string) =>
      page.evaluate(
        ([id, offerPeerId, offerSdp]) =>
          ZeroHubUnitHarness.sendOfferMessage(id, offerPeerId, offerSdp),
        [id, offerPeerId, offerSdp] as const,
      ),
    sendAnswerMessage: (id: number, answerPeerId: string, answerSdp: string) =>
      page.evaluate(
        ([id, answerPeerId, answerSdp]) =>
          ZeroHubUnitHarness.sendAnswerMessage(id, answerPeerId, answerSdp),
        [id, answerPeerId, answerSdp] as const,
      ),
    sendPeerDisconnected: (id: number, peerId: string) =>
      page.evaluate(
        ([id, peerId]) => ZeroHubUnitHarness.sendPeerDisconnected(id, peerId),
        [id, peerId] as const,
      ),
    wait: (ms: number) => page.evaluate((ms) => ZeroHubUnitHarness.wait(ms), ms),
  };
}

type Driver = ReturnType<typeof driver>;

/**
 * Simulates a P2P drop the way a real `RTCPeerConnection` reports one: the
 * connection state falls to `disconnected` AND ICE reports `failed` (NAT
 * rebinding / candidate expiry). Both signals must coalesce into a single
 * deferred recovery.
 */
async function forceP2pDrop(h: Driver, id: number, peerId: string) {
  await h.setConnectionState(id, peerId, "disconnected");
  await h.setIceState(id, peerId, "failed");
}

/**
 * Marks the peer as negotiated (the initial offer/answer exchange completed —
 * the precondition for a drop: a connection that never negotiated has no
 * established P2P link to recover) and drives it to `connected`.
 */
async function establishPeer(
  h: {
    setPeerRemoteDescription: (id: number, peerId: string, type: string) => Promise<unknown>;
    setConnectionState: (id: number, peerId: string, state: string) => Promise<unknown>;
    getPeerStatus: (id: number, peerId: string) => Promise<string | null>;
  },
  id: number,
  peerId: string,
  remoteDescriptionType: string,
) {
  await h.setPeerRemoteDescription(id, peerId, remoteDescriptionType);
  await h.setConnectionState(id, peerId, "connected");
  expect(await h.getPeerStatus(id, peerId)).toBe("connected");
}

/**
 * Brings up a client on the given topology, registers it in the hub (which
 * adds the peer and drives it to `Pending`), and returns its opaque id. The
 * status recorder is installed BEFORE `sendHubInfo` so the initial
 * `pending` transition is captured too.
 */
async function setupClient(
  h: Driver,
  topology: "mesh" | "sfu",
  myPeerId: string,
  remotePeerId: string,
) {
  const id = await h.createClientWithTopology(topology);
  await h.recordStatusChanges(id);
  await h.sendHubInfo(id, myPeerId, [remotePeerId]);
  await h.stubSocket(id);
  await h.setWaitIceTimeout(id, 50);
  return id;
}

test.describe("P2P WebRTC drop recovery", () => {
  test("mesh offerer: a dropped peer is re-negotiated and returns to connected", async ({
    page,
  }) => {
    await prepareUnitHarnessPage(page);
    const h = driver(page);
    // Local client is peer "1", remote peer is "2": `2 > 1` makes the LOCAL
    // client the mesh offerer, so it must issue the recovery offer.
    const id = await setupClient(h, "mesh", "1", "2");
    await establishPeer(h, id, "2", "answer");

    await forceP2pDrop(h, id, "2");
    // Both drop signals funnel into a single deferred recovery.
    expect(await h.webrtcRecoveryEntries(id)).toEqual(["2"]);

    // Outlast the private recovery delay: the peer must be marked
    // webrtc_disconnected and the topology must issue exactly one fresh
    // offer over the still-alive (stubbed) signaling socket, after which the
    // peer advances to `offering` (same connection, re-negotiated).
    await h.wait(800);
    expect(
      (await h.drainStatusChanges(id)).map(
        (e: { status: string }) => e.status,
      ),
    ).toEqual([
      "pending",
      "connected",
      "webrtc_disconnected",
      "offering",
    ]);
    const sends = await h.drainSends(id);
    expect(sends.filter((s) => s.kind === "offer")).toEqual([
      { kind: "offer", peerId: "2", sdp: "offer-sdp" },
    ]);

    // The remote side answers and the P2P link recovers: the peer must
    // transition back to connected on the same RTCPeerConnection.
    await h.sendAnswerMessage(id, "2", "answer-sdp");
    await h.setConnectionState(id, "2", "connected");
    expect(await h.getPeerStatus(id, "2")).toBe("connected");
    expect(
      (await h.drainStatusChanges(id)).map(
        (e: { status: string }) => e.status,
      ),
    ).toEqual(["accept_pending", "connected"]);
  });

  test("mesh answerer: does not re-offer on its own; recovers when the remote offer arrives", async ({
    page,
  }) => {
    await prepareUnitHarnessPage(page);
    const h = driver(page);
    // Local client is peer "2", remote peer is "1": the REMOTE peer is the
    // mesh offerer, so this client must stay silent until its offer arrives.
    const id = await setupClient(h, "mesh", "2", "1");
    await establishPeer(h, id, "1", "offer");

    await forceP2pDrop(h, id, "1");
    await h.wait(800);
    // The drop is surfaced but the answerer must not emit SDP of its own.
    expect(await h.getPeerStatus(id, "1")).toBe("webrtc_disconnected");
    expect(
      (await h.drainStatusChanges(id)).map(
        (e: { status: string }) => e.status,
      ),
    ).toEqual([
      "pending",
      "connected",
      "webrtc_disconnected",
    ]);
    expect(await h.drainSends(id)).toEqual([]);

    // The remote offerer's recovery offer lands: auto-answer (default) sends
    // the answer over the signaling socket, and the link returns to connected.
    await h.sendOfferMessage(id, "1", "offer-sdp");
    await h.wait(150);
    const sends = await h.drainSends(id);
    expect(sends.filter((s) => s.kind === "answer")).toEqual([
      { kind: "answer", peerId: "1", sdp: "answer-sdp" },
    ]);
    await h.setConnectionState(id, "1", "connected");
    expect(await h.getPeerStatus(id, "1")).toBe("connected");
  });

  test("sfu: the SFU re-offers a dropped client; a non-SFU peer stays silent", async ({
    page,
  }) => {
    await prepareUnitHarnessPage(page);
    const h = driver(page);

    // SFU client: lowest id ("1") in the hub, so it is the SFU and the offerer
    // to client "2". Its recovery path must re-offer.
    const sfuId = await setupClient(h, "sfu", "1", "2");
    await establishPeer(h, sfuId, "2", "answer");
    await forceP2pDrop(h, sfuId, "2");
    await h.wait(800);
    expect(
      (await h.drainStatusChanges(sfuId)).map(
        (e: { status: string }) => e.status,
      ),
    ).toEqual(["pending", "connected", "webrtc_disconnected", "offering"]);
    const sfuSends = await h.drainSends(sfuId);
    expect(sfuSends.filter((s) => s.kind === "offer")).toEqual([
      { kind: "offer", peerId: "2", sdp: "offer-sdp" },
    ]);
    await h.setConnectionState(sfuId, "2", "connected");
    expect(await h.getPeerStatus(sfuId, "2")).toBe("connected");

    // Non-SFU client: "2" alongside SFU "1" is never the offerer, so its
    // WebRTCDisconnected case must not emit any SDP.
    const clientId = await setupClient(h, "sfu", "2", "1");
    await establishPeer(h, clientId, "1", "offer");
    await forceP2pDrop(h, clientId, "1");
    await h.wait(800);
    expect(await h.getPeerStatus(clientId, "1")).toBe("webrtc_disconnected");
    expect(await h.drainSends(clientId)).toEqual([]);
  });

  test("fast disconnected→connected flap coalesces into at most one re-negotiation", async ({
    page,
  }) => {
    await prepareUnitHarnessPage(page);
    const h = driver(page);
    const id = await setupClient(h, "mesh", "1", "2");
    await establishPeer(h, id, "2", "answer");

    // The connection flaps: both drop signals queue a recovery, then the
    // connection recovers on its own before the deferred timer fires.
    await forceP2pDrop(h, id, "2");
    await h.setConnectionState(id, "2", "connected");
    expect(await h.getPeerStatus(id, "2")).toBe("connected");

    await h.wait(800);
    // The timer fired against the LIVE state (connected) and stood down: no
    // webrtc_disconnected transition, no re-negotiation, no duplicate offer.
    expect(await h.getPeerStatus(id, "2")).toBe("connected");
    expect(
      (await h.drainStatusChanges(id)).filter(
        (e: { status: string }) => e.status === "webrtc_disconnected",
      ),
    ).toEqual([]);
    expect(await h.drainSends(id)).toEqual([]);
    expect(await h.webrtcRecoveryEntries(id)).toEqual([]);
  });

  test("a connection that never negotiated does not arm a recovery", async ({
    page,
  }) => {
    await prepareUnitHarnessPage(page);
    const h = driver(page);
    // No `establishPeer`: `remoteDescription` is still null, i.e. the initial
    // offer/answer exchange never completed.
    const id = await setupClient(h, "mesh", "1", "2");

    await forceP2pDrop(h, id, "2");
    // The pre-negotiation drop is a first-time failure, not a drop: no timer.
    expect(await h.webrtcRecoveryEntries(id)).toEqual([]);
    await h.wait(800);
    expect(await h.getPeerStatus(id, "2")).toBe("pending");
    expect(await h.drainSends(id)).toEqual([]);
  });

  test("tearing the peer down clears its pending recovery timer", async ({
    page,
  }) => {
    await prepareUnitHarnessPage(page);
    const h = driver(page);
    const id = await setupClient(h, "mesh", "1", "2");
    await establishPeer(h, id, "2", "answer");

    await forceP2pDrop(h, id, "2");
    expect(await h.webrtcRecoveryEntries(id)).toEqual(["2"]);

    // The server says the peer left the hub: the shared removePeer path must
    // clear the pending recovery so its timer cannot fire on a removed peer.
    await h.sendPeerDisconnected(id, "2");
    expect(await h.webrtcRecoveryEntries(id)).toEqual([]);
    expect(await h.getPeerStatus(id, "2")).toBeNull();
    await h.wait(800);
    // No late re-negotiation for a peer that is already gone.
    expect(await h.drainSends(id)).toEqual([]);
  });
});

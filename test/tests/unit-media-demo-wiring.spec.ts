import { test, expect, Page } from "@playwright/test";
import { prepareUnitHarnessPage } from "./utils/unit-harness";

/**
 * Regression test for the docs media playground bug (P0): the live media
 * demo (`docs/src/scripts/playground/media.ts`) created its `ZeroHubClient`
 * with a `mediaChannelConfig` that carried ONLY `onTrack` — the resolved
 * `getUserMedia` stream was assigned to a local variable and never passed
 * into `mediaChannelConfig.localStream`. The SDK reads
 * `mediaChannelConfig.localStream` at peer-setup time
 * (`client/src/topology/peerSetup.ts`, `setupMediaChannel`) and silently
 * adds no tracks when it is absent, so the local peer's audio/video was
 * never delivered to any remote peer and the remote side's `onTrack` never
 * fired.
 *
 * This spec pins the corrected wiring end-to-end through the real client +
 * `MeshTopology` stack (mocked `RTCPeerConnection` / `WebSocket`):
 *
 *  1. BOTH peers in a hub wire the media correctly:
 *     - the offerer's peer connection receives every track of its configured
 *       `localStream` (object identity, not a copy) at peer-setup time, and
 *     - the answerer's `onTrack` callback fires for the remote's incoming
 *       stream (the "second peer receives the remote's tracks" half that had
 *       zero coverage).
 *  2. The offerer still sends its offer AFTER the local tracks are added
 *     (the setup order the docs fix relies on).
 *  3. The broken-demo shape — `mediaChannelConfig` with `onTrack` but NO
 *     `localStream` — adds no tracks, so the regression is detectable and
 *     stays pinned.
 */

type MediaOnTrackCall = { peerId: string; streamId: string };
type AddedTrack = { isConfiguredStream: boolean; trackKinds: string[] };

/** The in-page driver surface (window.ZeroHubUnitHarness). */
function driver(page: Page) {
  return {
    createClientWithMedia: (trackCount: number) =>
      page.evaluate(
        (trackCount) => ZeroHubUnitHarness.createClientWithMedia(trackCount),
        trackCount,
      ),
    createClientWithMediaNoStream: () =>
      page.evaluate(() => ZeroHubUnitHarness.createClientWithMediaNoStream()),
    sendHubInfo: (id: number, myPeerId: string, peerIds: string[]) =>
      page.evaluate(
        ([id, myPeerId, peerIds]) =>
          ZeroHubUnitHarness.sendHubInfo(id, myPeerId, peerIds),
        [id, myPeerId, peerIds] as const,
      ),
    sendOfferMessage: (id: number, offerPeerId: string, offerSdp: string) =>
      page.evaluate(
        ([id, offerPeerId, offerSdp]) =>
          ZeroHubUnitHarness.sendOfferMessage(id, offerPeerId, offerSdp),
        [id, offerPeerId, offerSdp] as const,
      ),
    stubSocket: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.stubSocket(id), id),
    invokeSendOffer: (id: number, peerId: string) =>
      page.evaluate(
        ([id, peerId]) => ZeroHubUnitHarness.invokeSendOffer(id, peerId),
        [id, peerId] as const,
      ),
    setWaitIceTimeout: (id: number, ms: number) =>
      page.evaluate(
        ([id, ms]) => ZeroHubUnitHarness.setWaitIceTimeout(id, ms),
        [id, ms] as const,
      ),
    fireIceCandidate: (id: number, peerId: string, candidate: unknown) =>
      page.evaluate(
        ([id, peerId, candidate]) =>
          ZeroHubUnitHarness.fireIceCandidate(id, peerId, candidate),
        [id, peerId, candidate] as const,
      ),
    getPeerStatus: (id: number, peerId: string) =>
      page.evaluate(
        ([id, peerId]) => ZeroHubUnitHarness.getPeerStatus(id, peerId),
        [id, peerId] as const,
      ),
    getSends: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.getSends(id), id),
    getAddedTracks: (id: number, peerId: string) =>
      page.evaluate(
        ([id, peerId]) => ZeroHubUnitHarness.getAddedTracks(id, peerId),
        [id, peerId] as const,
      ),
    fireOnTrack: (id: number, peerId: string, remoteStreamId: string) =>
      page.evaluate(
        ([id, peerId, remoteStreamId]) =>
          ZeroHubUnitHarness.fireOnTrack(id, peerId, remoteStreamId),
        [id, peerId, remoteStreamId] as const,
      ),
    getMediaOnTrackCalls: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.getMediaOnTrackCalls(id), id),
  };
}

/**
 * Shared two-peer hub: `offerer` is myPeerId "1" (the lower id — it answers),
 * `answerer` is myPeerId "2" (the higher id — mesh offerer: 2 > 1). Both are
 * media clients with a fake local stream of 2 tracks (audio + video),
 * mirroring `getUserMedia({ audio: true, video: true })`.
 */
async function setupMediaPair(page: Page) {
  const h = driver(page);
  const offerer = await h.createClientWithMedia(2);
  const answerer = await h.createClientWithMedia(2);
  // The hub tells each side the other is present. `addPeer` fires the
  // topology's Pending hook, which runs `setupMediaChannel` (add local
  // tracks + install ontrack) — the exact moment the docs bug dropped.
  await h.sendHubInfo(offerer, "1", ["2"]);
  await h.sendHubInfo(answerer, "2", ["1"]);
  return { h, offerer, answerer };
}

test("media peers both wire local-stream tracks and the receiving peer's onTrack fires for the remote's stream", async ({
  page,
}) => {
  await prepareUnitHarnessPage(page);
  const { h, offerer, answerer } = await setupMediaPair(page);

  await test.step("the offerer's peer connection received every local track, with the configured stream", async () => {
    const added = (await h.getAddedTracks(answerer, "1")) as AddedTrack[];
    // Every track of the local stream was added...
    expect(added.map((a) => a.trackKinds)).toEqual([
      ["audio"],
      ["video"],
    ]);
    // ...and each addTrack received the configured localStream object
    // itself (identity — a reassigned/copied stream would fail).
    for (const call of added) {
      expect(call.isConfiguredStream).toBe(true);
    }
  });

  await test.step("the answerer's peer connection received every local track too (mesh is symmetric)", async () => {
    const added = (await h.getAddedTracks(offerer, "2")) as AddedTrack[];
    expect(added.map((a) => a.trackKinds)).toEqual([
      ["audio"],
      ["video"],
    ]);
    for (const call of added) {
      expect(call.isConfiguredStream).toBe(true);
    }
  });

  await test.step("the answerer's user onTrack fires for the remote's incoming stream", async () => {
    // Simulate the WebRTC stack delivering the remote (offerer "1") media
    // once the negotiation completes: the receiving side's ontrack event.
    await h.fireOnTrack(answerer, "1", "remote-stream-a");
    const calls = (await h.getMediaOnTrackCalls(answerer)) as MediaOnTrackCall[];
    expect(calls).toEqual([{ peerId: "1", streamId: "remote-stream-a" }]);
    // A second stream (e.g. a re-negotiation's replacement track) reaches
    // the callback as well — the demo adds a <video> per such event.
    await h.fireOnTrack(answerer, "1", "remote-stream-b");
    expect(await h.getMediaOnTrackCalls(answerer)).toEqual([
      { peerId: "1", streamId: "remote-stream-a" },
      { peerId: "1", streamId: "remote-stream-b" },
    ]);
  });
});

test("the mesh offerer sends its offer AFTER its local media tracks are added", async ({
  page,
}) => {
  await prepareUnitHarnessPage(page);
  const { h, offerer, answerer } = await setupMediaPair(page);

  await test.step("local media tracks were added at peer-setup, before any offer", async () => {
    // The topology's Pending hook (fired when the hub info arrived) already
    // ran setupMediaChannel: the outgoing media is on the connection NOW —
    // before the signaling socket even exists. (With the pre-fix demo the
    // stream was absent from the config, so this list would be empty.)
    const added = (await h.getAddedTracks(answerer, "1")) as AddedTrack[];
    expect(added.map((a) => a.trackKinds)).toEqual([["audio"], ["video"]]);
    expect(await h.getPeerStatus(answerer, "1")).toBe("pending");
    // No SDP went out without a signaling socket.
    expect(await h.getSends(answerer)).toHaveLength(0);
  });

  await test.step("the offerer's sendOffer now succeeds and its SDP is sent", async () => {
    h.stubSocket(answerer);
    h.setWaitIceTimeout(answerer, 50); // keep the fallback timer out of the test
    await h.invokeSendOffer(answerer, "1");
    // Fire the gathering-complete marker to release the SDP send.
    await h.fireIceCandidate(answerer, "1", null);
    const sends = await h.getSends(answerer);
    expect(sends).toHaveLength(1);
    expect(sends[0].kind).toBe("offer");
    expect(sends[0].peerId).toBe("1");
    expect(await h.getPeerStatus(answerer, "1")).toBe("offering");
  });

  await test.step("the answerer auto-answers and accepts the offer", async () => {
    h.stubSocket(offerer);
    h.setWaitIceTimeout(offerer, 50);
    const sendsBefore = await h.getSends(answerer);
    const offer = sendsBefore.find((s) => s.kind === "offer");
    expect(offer?.sdp).toBe("offer-sdp");
    await h.sendOfferMessage(offerer, "2", offer?.sdp ?? "");
    await h.fireIceCandidate(offerer, "2", null);
    const sends = await h.getSends(offerer);
    expect(sends).toHaveLength(1);
    expect(sends[0].kind).toBe("answer");
    expect(await h.getPeerStatus(offerer, "2")).toBe("answering");
  });
});

test("a mediaChannelConfig without localStream adds no tracks (the broken-demo shape stays detectable)", async ({
  page,
}) => {
  await prepareUnitHarnessPage(page);
  const h = driver(page);
  const broken = await h.createClientWithMediaNoStream();

  await h.sendHubInfo(broken, "1", ["2"]);

  await test.step("no local tracks are added, but onTrack is still installed for incoming media", async () => {
    // The pre-fix demo shape: the SDK cannot add tracks it was never given.
    const added = (await h.getAddedTracks(broken, "2")) as AddedTrack[];
    expect(added).toHaveLength(0);
    // The receiving side still works — only the outgoing side is blind.
    await h.fireOnTrack(broken, "2", "remote-stream-x");
    expect(await h.getMediaOnTrackCalls(broken)).toEqual([
      { peerId: "2", streamId: "remote-stream-x" },
    ]);
  });
});

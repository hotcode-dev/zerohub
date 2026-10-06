import { test, expect, Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Unit tests for the `peerJoinedMessage` (mid-session join) vs
 * `hubInfoMessage` (initial join) peer-construction paths in
 * `ZeroHubClient.handleZeroHubMessage`.
 *
 * These run without a server or a real WebRTC stack: the client is bundled
 * (test/scripts/build-unit-harness.mjs) with a mocked `RTCPeerConnection` and
 * a no-op topology, and driven through `handleZeroHubMessage` with the raw
 * message shapes the client would receive from the signaling server.
 *
 * The driver lives inside the browser page (window.ZeroHubUnitHarness) and is
 * invoked via page.evaluate; each call returns only serializable data.
 *
 * Covers:
 *  1. A `peerJoinedMessage` for an already-present peer does NOT overwrite the
 *     existing Peer / leak its RTCPeerConnection and does NOT reset its status.
 *  2. `oniceconnectionstatechange` is wired on mid-session joiners and a
 *     simulated `iceConnectionState === "failed"` triggers `restartIce()`.
 *  3. The `hubInfoMessage` and `peerJoinedMessage` paths produce equivalent
 *     `Peer` wiring (both connection-state handlers present) — regression.
 */

type PeerSnapshot = {
  status: string;
  rtcConnId: number;
  hasConnStateHandler: boolean;
  hasIceHandler: boolean;
  restartIceCount: number;
  connClosed: boolean;
  connectionState: string;
  iceConnectionState: string;
  metadata: string;
  joinTimeMs: number;
};

/** The in-page driver surface (window.ZeroHubUnitHarness). */
type Harness = {
  createClient(): number;
  sendHubInfo(id: number, myPeerId: string, peerIds: string[]): void;
  sendPeerJoined(id: number, peerId: string): void;
  setConnectionState(id: number, peerId: string, state: string): PeerSnapshot;
  setIceState(id: number, peerId: string, state: string): PeerSnapshot;
  getPeer(id: number, peerId: string): PeerSnapshot;
  connectionsCreated(id: number): number;
  referencedConnectionIds(id: number): number[];
};

declare global {
  // eslint-disable-next-line no-var
  var ZeroHubUnitHarness: Harness;
}

/** Inject the unit harness (mocked RTCPeerConnection + driver) into a page. */
async function prepareUnitHarnessPage(page: Page) {
  await page.addInitScript({ path: unitHarnessPath() });
  const html = "<html><head></head><body></body></html>";
  await page.goto(`data:text/html,${encodeURIComponent(html)}`);
}

function unitHarnessPath(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../dist/unit-harness.js",
  );
}

/**
 * Thin serializable wrappers. `page.evaluate` can only hand back data (not
 * live functions) and only serializes args from Node (where `window` is
 * absent), so each method re-enters the page and invokes the driver via the
 * in-page global `ZeroHubUnitHarness`, passing only scalar/serializable args.
 */
function driver(page: Page) {
  return {
    createClient: () => page.evaluate(() => ZeroHubUnitHarness.createClient()),
    sendHubInfo: (id: number, myPeerId: string, peerIds: string[]) =>
      page.evaluate(
        ([id, myPeerId, peerIds]) =>
          ZeroHubUnitHarness.sendHubInfo(id, myPeerId, peerIds),
        [id, myPeerId, peerIds] as const,
      ),
    sendPeerJoined: (id: number, peerId: string) =>
      page.evaluate(
        ([id, peerId]) => ZeroHubUnitHarness.sendPeerJoined(id, peerId),
        [id, peerId] as const,
      ),
    setConnectionState: (id: number, peerId: string, state: string) =>
      page.evaluate(
        ([id, peerId, state]) =>
          ZeroHubUnitHarness.setConnectionState(id, peerId, state),
        [id, peerId, state] as const,
      ),
    setIceState: (id: number, peerId: string, state: string) =>
      page.evaluate(
        ([id, peerId, state]) =>
          ZeroHubUnitHarness.setIceState(id, peerId, state),
        [id, peerId, state] as const,
      ),
    getPeer: (id: number, peerId: string) =>
      page.evaluate(([id, peerId]) => ZeroHubUnitHarness.getPeer(id, peerId), [
        id,
        peerId,
      ] as const),
    connectionsCreated: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.connectionsCreated(id), id),
    referencedConnectionIds: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.referencedConnectionIds(id), id),
  };
}

test.describe("ZeroHubClient peer wiring (hubInfo vs peerJoined)", () => {
  test("mid-session joiner gets the full wiring and restarts ICE on failure", async ({
    page,
  }) => {
    await prepareUnitHarnessPage(page);
    const h = driver(page);
    const id = await h.createClient();

    // Initial snapshot: we are peer "1", peer "2" is already known via hubInfo.
    await h.sendHubInfo(id, "1", ["2"]);
    const initial = (await h.getPeer(id, "2")) as PeerSnapshot;
    expect(initial.status).toBe("pending");
    expect(initial.rtcConnId).toBeGreaterThan(0);

    // A NEW mid-session joiner ("3") arrives via peerJoinedMessage.
    await h.sendPeerJoined(id, "3");
    const joined = (await h.getPeer(id, "3")) as PeerSnapshot;

    await test.step("mid-session joiner has both state handlers wired", () => {
      expect(joined.status).toBe("pending");
      expect(joined.rtcConnId).toBeGreaterThan(0);
      expect(joined.hasConnStateHandler).toBe(true);
      // The fix: mid-session joiners must also get the ICE-restart handler.
      expect(joined.hasIceHandler).toBe(true);
      expect(joined.restartIceCount).toBe(0);
    });

    await test.step("simulating iceConnectionState === 'failed' triggers restartIce()", async () => {
      const after = (await h.setIceState(id, "3", "failed")) as PeerSnapshot;
      expect(after.restartIceCount).toBe(1);
      // Non-failed ICE states must not restart.
      const idle = (await h.setIceState(id, "3", "checking")) as PeerSnapshot;
      expect(idle.restartIceCount).toBe(1);
    });

    await test.step("simulating connectionState 'connected' transitions the peer", async () => {
      const after = (await h.setConnectionState(
        id,
        "3",
        "connected",
      )) as PeerSnapshot;
      expect(after.status).toBe("connected");
    });
  });

  test("peerJoinedMessage for an existing peer reuses its RTCPeerConnection", async ({
    page,
  }) => {
    await prepareUnitHarnessPage(page);
    const h = driver(page);
    const id = await h.createClient();

    await h.sendHubInfo(id, "1", ["2"]);
    const before = (await h.getPeer(id, "2")) as PeerSnapshot;
    const beforeConnId = before.rtcConnId;
    expect(beforeConnId).toBeGreaterThan(0);

    // Drive the peer's live connection to "connected" so it is no longer
    // Pending — this makes the bug (status reset) observable.
    await h.setConnectionState(id, "2", "connected");
    expect(((await h.getPeer(id, "2")) as PeerSnapshot).status).toBe(
      "connected",
    );

    const connsBefore = await h.connectionsCreated(id);
    const refsBefore = (await h.referencedConnectionIds(id)) as number[];

    // Re-broadcast / re-delivery of the join signal for the SAME peer.
    await h.sendPeerJoined(id, "2");

    await test.step("the existing RTCPeerConnection is reused (not replaced/leaked)", async () => {
      const after = (await h.getPeer(id, "2")) as PeerSnapshot;
      // Same live connection object — not a brand-new one.
      expect(after.rtcConnId).toBe(beforeConnId);
      // No additional RTCPeerConnection was created for the duplicate join.
      expect(await h.connectionsCreated(id)).toBe(connsBefore);
      // The map still references exactly the same connection.
      expect(await h.referencedConnectionIds(id)).toEqual(refsBefore);
    });

    await test.step("the established peer is NOT reset back to Pending", async () => {
      // The fix prevents overwriting: status stays "connected".
      expect(((await h.getPeer(id, "2")) as PeerSnapshot).status).toBe(
        "connected",
      );
    });

    await test.step("a genuinely new peer still gets a fresh connection", async () => {
      await h.sendPeerJoined(id, "9");
      const fresh = (await h.getPeer(id, "9")) as PeerSnapshot;
      expect(fresh.status).toBe("pending");
      expect(fresh.rtcConnId).not.toBe(beforeConnId);
      expect(await h.connectionsCreated(id)).toBe(connsBefore + 1);
    });
  });

  test("hubInfoMessage and peerJoinedMessage produce equivalent Peer wiring", async ({
    page,
  }) => {
    await prepareUnitHarnessPage(page);
    const h = driver(page);

    // Client A: peer arrives via the INITIAL path (hubInfo).
    const aId = await h.createClient();
    await h.sendHubInfo(aId, "1", ["2"]);
    const viaHub = (await h.getPeer(aId, "2")) as PeerSnapshot;

    // Client B: peer arrives via the MID-SESSION path (peerJoined).
    const bId = await h.createClient();
    await h.sendHubInfo(bId, "1", []); // set myPeerId + hubInfo first (required)
    await h.sendPeerJoined(bId, "2");
    const viaJoined = (await h.getPeer(bId, "2")) as PeerSnapshot;

    await test.step("both paths start the peer as Pending", () => {
      expect(viaHub.status).toBe("pending");
      expect(viaJoined.status).toBe("pending");
    });

    await test.step("both paths wire both connection-state handlers", () => {
      const wiring = (s: PeerSnapshot) => ({
        hasConnStateHandler: s.hasConnStateHandler,
        hasIceHandler: s.hasIceHandler,
      });
      expect(wiring(viaHub)).toEqual({
        hasConnStateHandler: true,
        hasIceHandler: true,
      });
      // The regression guard: the mid-session path must match the initial path.
      expect(wiring(viaJoined)).toEqual(wiring(viaHub));
    });

    await test.step("both paths trigger restartIce() identically on ICE failure", async () => {
      const a = (await h.setIceState(aId, "2", "failed")) as PeerSnapshot;
      const b = (await h.setIceState(bId, "2", "failed")) as PeerSnapshot;
      expect(a.restartIceCount).toBe(1);
      expect(b.restartIceCount).toBe(1);
      expect(a.restartIceCount).toBe(b.restartIceCount);
    });
  });
});

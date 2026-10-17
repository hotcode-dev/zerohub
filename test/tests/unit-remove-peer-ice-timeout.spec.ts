import { test, expect, Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Regression test: `removePeer` (the shared per-peer teardown path) must
 * clear the peer's pending ICE-candidate fallback timer.
 *
 * `sendOffer` / `sendAnswer` arm a `waitIceCandidatesTimeout` timer via
 * `armSendOnIceReady` that sends the local SDP when ICE gathering completes.
 * Before the fix, `removePeer` closed the peer's `RTCPeerConnection` and
 * deleted the peer from the map WITHOUT clearing
 * `this.iceTimeouts[peerId]`, so on every ordinary peer-leave (the
 * `peerDisconnectedMessage` broadcast path), roster-prune (the
 * `hubInfoMessage` reconciliation path after a reconnect), or `disconnect()`,
 * the orphaned timer survived for up to `waitIceCandidatesTimeout` (default
 * 2000ms). Two observable defects followed:
 *
 *  1. Leak: the closure kept a strong reference to the already-closed
 *     `RTCPeerConnection` alive until the timer fired, deferring GC of
 *     closed connections on a hub with churn.
 *  2. Stale send: when the orphaned timer fired, its body guarded on
 *     `!rtcConn.localDescription || isSent` — but the timer is armed *after*
 *     `setLocalDescription` in both `sendOffer` and `sendAnswer`, so
 *     `localDescription` is typically truthy and the guard did NOT suppress
 *     it. `sendOnce()` then attempted `ws.send(...)` for a peer that no
 *     longer exists in the hub (an error/throw risk if the socket was torn
 *     down in the meantime).
 *
 * The fix centralizes the cleanup in `removePeer`: it clears and deletes the
 * pending handle for the peer before closing the connection, so the three
 * callers can never diverge.
 *
 * Runs without a server or real WebRTC: the client is bundled with the unit
 * harness (mocked `WebSocket`, mocked `RTCPeerConnection`, no-op topology)
 * and driven through `window.ZeroHubUnitHarness`.
 *
 * Covers:
 *  (a) a `peerDisconnectedMessage` for a peer with a pending ICE timer
 *      removes the `iceTimeouts` entry and no SDP is sent after the ICE
 *      window elapses.
 *  (b) the `hubInfoMessage` roster-prune path does the same for a peer
 *      absent from the re-issued roster.
 *  (c) control: a peer that STAYS in the hub still gets its SDP sent by the
 *      fallback timer when the window elapses (the timer is only cleared on
 *      teardown, never preemptively).
 */

type Send = { kind: "offer" | "answer"; peerId: string; sdp: string };

/** The in-page driver surface (window.ZeroHubUnitHarness). */
type Harness = {
  createClient(): number;
  stubSocket(id: number): void;
  sendHubInfo(id: number, myPeerId: string, peerIds: string[]): void;
  sendPeerDisconnected(id: number, peerId: string): void;
  setWaitIceTimeout(id: number, ms: number): void;
  invokeSendOffer(
    id: number,
    peerId: string,
    options?: { offerToReceiveAudio?: boolean; offerToReceiveVideo?: boolean },
  ): Promise<{ configOptions: string; sentOptions: string }>;
  iceTimeoutEntries(id: number): string[];
  getSends(id: number): Send[];
  getPeerStatus(id: number, peerId: string): string | null;
};

declare global {
  // eslint-disable-next-line no-var
  var ZeroHubUnitHarness: Harness;
}

/** Inject the unit harness into a page. */
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

function driver(page: Page) {
  return {
    createClient: () => page.evaluate(() => ZeroHubUnitHarness.createClient()),
    stubSocket: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.stubSocket(id), id),
    sendHubInfo: (id: number, myPeerId: string, peerIds: string[]) =>
      page.evaluate(
        ([id, myPeerId, peerIds]) =>
          ZeroHubUnitHarness.sendHubInfo(id, myPeerId, peerIds),
        [id, myPeerId, peerIds] as const,
      ),
    sendPeerDisconnected: (id: number, peerId: string) =>
      page.evaluate(
        ([id, peerId]) => ZeroHubUnitHarness.sendPeerDisconnected(id, peerId),
        [id, peerId] as const,
      ),
    setWaitIceTimeout: (id: number, ms: number) =>
      page.evaluate(
        ([id, ms]) => ZeroHubUnitHarness.setWaitIceTimeout(id, ms),
        [id, ms] as const,
      ),
    invokeSendOffer: (id: number, peerId: string) =>
      page.evaluate(
        ([id, peerId]) => ZeroHubUnitHarness.invokeSendOffer(id, peerId),
        [id, peerId] as const,
      ),
    iceTimeoutEntries: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.iceTimeoutEntries(id), id),
    getSends: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.getSends(id), id),
    getPeerStatus: (id: number, peerId: string) =>
      page.evaluate(
        ([id, peerId]) => ZeroHubUnitHarness.getPeerStatus(id, peerId),
        [id, peerId] as const,
      ),
  };
}

test.describe("ZeroHubClient removePeer clears the pending ICE-candidate timer", () => {
  test("peerDisconnectedMessage clears the timer and no SDP fires after the window", async ({
    page,
  }) => {
    await prepareUnitHarnessPage(page);
    const h = driver(page);
    const id = await h.createClient();
    // No real socket: the capturing stub is all `sendOffer` needs.
    await h.stubSocket(id);

    await h.sendHubInfo(id, "1", ["2"]);
    expect(await h.getPeerStatus(id, "2")).toBe("pending");

    // Arm the offer with a short ICE window. No ICE candidates ever arrive
    // on the mock connection, so the fallback timer is the only thing that
    // would send the SDP — and it must still be pending when the peer leaves.
    await h.setWaitIceTimeout(id, 200);
    await h.invokeSendOffer(id, "2");
    expect(await h.getSends(id)).toHaveLength(0);
    expect(await h.iceTimeoutEntries(id)).toEqual(["2"]);

    // Peer "2" leaves the hub while its ICE candidates are still pending.
    await h.sendPeerDisconnected(id, "2");
    expect(await h.getPeerStatus(id, "2")).toBe(null);

    await test.step("the iceTimeouts entry for the removed peer is cleared", async () => {
      expect(await h.iceTimeoutEntries(id)).toEqual([]);
    });

    await test.step("the orphaned timer does not fire after the window elapses", async () => {
      // Comfortably past the 200ms window: had the timer been orphaned,
      // `sendOnce` would have fired `ws.send` for a peer no longer in the
      // hub (stale send).
      await page.waitForTimeout(400);
      expect(await h.getSends(id)).toHaveLength(0);
    });
  });

  test("roster-prune clears the timer and no SDP fires after the window", async ({
    page,
  }) => {
    await prepareUnitHarnessPage(page);
    const h = driver(page);
    const id = await h.createClient();
    await h.stubSocket(id);

    await h.sendHubInfo(id, "1", ["2", "3"]);
    expect(await h.getPeerStatus(id, "3")).toBe("pending");

    // Peer "3" is mid-negotiation (offer pending ICE candidates) when we
    // reconnect.
    await h.setWaitIceTimeout(id, 300);
    await h.invokeSendOffer(id, "3");
    expect(await h.iceTimeoutEntries(id)).toEqual(["3"]);

    // Reconnect: the authoritative roster no longer lists peer "3" (it
    // left while the socket was down, so no peerDisconnectedMessage was
    // broadcast) — the roster reconcile prunes it via `removePeer`.
    await h.sendHubInfo(id, "1", ["2"]);
    expect(await h.getPeerStatus(id, "3")).toBe(null);

    await test.step("the pruned peer's iceTimeouts entry is cleared", async () => {
      expect(await h.iceTimeoutEntries(id)).toEqual([]);
    });

    await test.step("the orphaned timer does not fire after the window elapses", async () => {
      await page.waitForTimeout(500);
      expect(await h.getSends(id)).toHaveLength(0);
    });

    await test.step("the surviving peer is untouched by the prune", async () => {
      expect(await h.getPeerStatus(id, "2")).toBe("pending");
    });
  });

  test("a peer that stays in the hub still gets its SDP sent by the fallback timer", async ({
    page,
  }) => {
    await prepareUnitHarnessPage(page);
    const h = driver(page);
    const id = await h.createClient();
    await h.stubSocket(id);

    await h.sendHubInfo(id, "1", ["2"]);

    await test.step("the timer is the normal send path for a live peer", async () => {
      await h.setWaitIceTimeout(id, 100);
      await h.invokeSendOffer(id, "2");
      expect(await h.getSends(id)).toHaveLength(0);
      expect(await h.iceTimeoutEntries(id)).toEqual(["2"]);

      // The peer stays in the hub: the timer must fire and send the offer.
      await page.waitForTimeout(300);
      const sends = (await h.getSends(id)) as Send[];
      expect(sends).toHaveLength(1);
      expect(sends[0].kind).toBe("offer");
      expect(sends[0].peerId).toBe("2");
      expect(sends[0].sdp).toBe("offer-sdp");

      // The timer body deletes its own entry on fire, so the map is clean.
      expect(await h.iceTimeoutEntries(id)).toEqual([]);
    });
  });
});

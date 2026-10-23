import { test, expect, Page } from "@playwright/test";
import { prepareUnitHarnessPage } from "./utils/unit-harness";

/**
 * Regression test: `connectToZeroHub()` must keep pending ICE-candidate
 * timeout handles tracked in `this.iceTimeouts` across a reconnect.
 *
 * `sendOffer` / `sendAnswer` arm a `waitIceCandidatesTimeout` timer via
 * `armSendOnIceReady` that sends the local SDP when ICE gathering completes.
 * Before the fix, `connectToZeroHub()` unconditionally reset
 * `this.iceTimeouts = {}`, ORPHANING any timer armed on the previous
 * socket: the handle was no longer reachable, so neither `disconnect()`
 * (which clears `this.iceTimeouts`) nor a re-armed
 * `armSendOnIceReady` (which clears the prior handle for the peer) could
 * cancel it. Two observable defects followed:
 *
 *  1. Duplicate delivery: a re-armed offer/answer could not cancel the
 *     orphaned prior timer, so BOTH timers fired and the SDP was sent a
 *     second time (a stale offer/answer on top of the fresh one).
 *  2. Leak onto a later socket: a manual `disconnect()` after the
 *     reconnect could not clear the orphaned timer, so a still-pending
 *     SDP send fired onto a socket opened by a later `createHub()` —
 *     exactly what the old comment claimed to prevent ("no offer/answer
 *     can be sent to a closed socket").
 *
 * The fix removes the reset from `connectToZeroHub()`: the pending handle
 * stays tracked, so `disconnect()` clears it (the manual-teardown
 * guarantee still holds) and a re-arm cancels it (no duplicate send).
 * The `isSent` guard in `armSendOnIceReady` independently prevents the
 * in-flight timer from re-sending once the SDP went out.
 *
 * Runs without a server or real WebRTC: the client is bundled with the unit
 * harness (mocked `WebSocket`, mocked `RTCPeerConnection`, no-op topology)
 * and driven through `window.ZeroHubUnitHarness`.
 *
 * Covers:
 *  (a) an in-flight offer survives a 1006 auto-reconnect: after the
 *     reconnect a re-armed offer must NOT double-send (the orphaned
 *     prior timer would have delivered a second, stale SDP).
 *  (b) a manual `disconnect()` after a reconnect still clears the pending
 *     ICE send: no SDP leaks onto a socket opened by a later `createHub()`.
 */

type Send = { kind: "offer" | "answer"; peerId: string; sdp: string };

/** The in-page driver surface (window.ZeroHubUnitHarness). */

function driver(page: Page) {
  return {
    createClientWithHosts: (hosts: string[]) =>
      page.evaluate(
        (hostList) => ZeroHubUnitHarness.createClientWithHosts(hostList),
        hosts,
      ),
    createHub: (id: number, hubId: string) =>
      page.evaluate(
        ([id, hubId]) => ZeroHubUnitHarness.createHub(id, hubId),
        [id, hubId] as const,
      ),
    sendHubInfo: (id: number, myPeerId: string, peerIds: string[]) =>
      page.evaluate(
        ([id, myPeerId, peerIds]) =>
          ZeroHubUnitHarness.sendHubInfo(id, myPeerId, peerIds),
        [id, myPeerId, peerIds] as const,
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
    captureSocket: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.captureSocket(id), id),
    getSocketCount: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.getSocketCount(id), id),
    getLastSocketUrl: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.getLastSocketUrl(id), id),
    simulateAbnormalClose: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.simulateAbnormalClose(id), id),
    disconnectClient: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.disconnectClient(id), id),
    getSends: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.getSends(id), id),
  };
}

/**
 * The reconnect flow (`reconnect` → `getZeroHubBackupHost().then(...)`)
 * settles in microtasks; flush them so the reconnected socket exists before
 * the next assertion.
 */
async function flushMicrotasks(page: Page) {
  await page.evaluate(async () => {
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

/**
 * Long ICE window: comfortably past the reconnect + re-arm latency so the
 * first timer is still pending when the socket drops, yet well under the
 * test timeout so its (orphaned) firing is observable inside the test.
 */
const FIRST_ICE_TIMEOUT_MS = 5000;
/** Short ICE window for the re-armed offer, so its send lands first. */
const SECOND_ICE_TIMEOUT_MS = 1000;

test.describe("ZeroHubClient ICE-candidate timer bookkeeping across reconnect", () => {
  test("a re-armed offer after a 1006 reconnect sends exactly once (no orphaned prior timer)", async ({
    page,
  }) => {
    await prepareUnitHarnessPage(page);
    const h = driver(page);

    // Two hosts so the 1006 abnormal close auto-fails over to host `b`
    // (a single-host client has no backup and would surface a terminal
    // error instead of reconnecting).
    const id = await h.createClientWithHosts([
      "a.zerohub.dev",
      "b.zerohub.dev",
    ]);

    // Initial connection: socket #1 opens against host `a`.
    await h.createHub(id, "room");
    expect(await h.getLastSocketUrl(id)).toBe(
      "wss://a.zerohub.dev/v1/hubs/create?id=room",
    );
    await h.sendHubInfo(id, "1", ["2"]);

    // Arm the offer with a long ICE window: no ICE candidates ever arrive
    // on the mock connection, so the fallback timer is the only thing
    // that will send the SDP — and it must still be pending when the
    // socket drops.
    await h.setWaitIceTimeout(id, FIRST_ICE_TIMEOUT_MS);
    await h.invokeSendOffer(id, "2");
    expect(await h.getSends(id)).toHaveLength(0);

    // Within the ICE window the signaling socket drops (network blip /
    // server restart): code 1006 triggers the automatic reconnect.
    await h.simulateAbnormalClose(id);
    await flushMicrotasks(page);
    expect(await h.getSocketCount(id)).toBe(2);
    expect(await h.getLastSocketUrl(id)).toBe(
      "wss://b.zerohub.dev/v1/hubs/create?id=room",
    );

    // Still inside the first timer's window: nothing has been sent yet.
    await page.waitForTimeout(200);
    expect(await h.getSends(id)).toHaveLength(0);

    // Application-level recovery: re-issue the offer on the new socket.
    // `armSendOnIceReady` clears the prior pending handle for this peer,
    // so exactly one timer may now fire.
    await h.captureSocket(id);
    await h.setWaitIceTimeout(id, SECOND_ICE_TIMEOUT_MS);
    await h.invokeSendOffer(id, "2");

    await test.step("the re-armed timer sends the offer on the new socket", async () => {
      await page.waitForTimeout(1600);
      const sends = (await h.getSends(id)) as Send[];
      expect(sends).toHaveLength(1);
      expect(sends[0].kind).toBe("offer");
      expect(sends[0].peerId).toBe("2");
      expect(sends[0].sdp).toBe("offer-sdp");
    });

    await test.step("the orphaned pre-reconnect timer must not double-send", async () => {
      // If `connectToZeroHub()` orphaned the first timer, it would still
      // fire (it was armed with a 5000ms window before the drop) and the
      // application's re-sent offer would be duplicated.
      await page.waitForTimeout(FIRST_ICE_TIMEOUT_MS);
      expect((await h.getSends(id)) as Send[]).toHaveLength(1);
    });
  });

  test("a manual disconnect after a reconnect still clears the pending ICE send", async ({
    page,
  }) => {
    await prepareUnitHarnessPage(page);
    const h = driver(page);
    const id = await h.createClientWithHosts([
      "a.zerohub.dev",
      "b.zerohub.dev",
    ]);

    await h.createHub(id, "room");
    await h.sendHubInfo(id, "1", ["2"]);

    // Arm the offer with a long ICE window; the timer must still be pending
    // when the socket drops and when the user disconnects.
    await h.setWaitIceTimeout(id, FIRST_ICE_TIMEOUT_MS);
    await h.invokeSendOffer(id, "2");
    expect(await h.getSends(id)).toHaveLength(0);

    // The signaling socket drops; the client auto-reconnects to host `b`.
    await h.simulateAbnormalClose(id);
    await flushMicrotasks(page);
    expect(await h.getSocketCount(id)).toBe(2);

    // Nothing has been sent yet (still inside the ICE window).
    await page.waitForTimeout(200);
    expect(await h.getSends(id)).toHaveLength(0);

    // The user gives up and manually disconnects: the pending ICE send
    // must be cleared, even though it was armed on the socket that just
    // reconnected.
    await h.disconnectClient(id);

    // Reuse the client: a fresh createHub opens a brand-new socket.
    await h.createHub(id, "room");
    expect(await h.getSocketCount(id)).toBe(3);
    await h.captureSocket(id);
    await h.sendHubInfo(id, "1", ["2"]);

    await test.step("no SDP from the pre-disconnect offer leaks onto the new socket", async () => {
      // Comfortably past the window the pending timer had left when the
      // user disconnected: had it been orphaned, the sendOnce closure
      // would have fired onto this socket.
      await page.waitForTimeout(FIRST_ICE_TIMEOUT_MS + 200);
      expect(await h.getSends(id)).toHaveLength(0);
    });
  });
});

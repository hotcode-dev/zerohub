import { test, expect, Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Regression test: a signaling message that lands while the reconnected
 * socket is still CONNECTING must not throw out of the ICE event handler
 * (a raw `InvalidStateError` from `ws.send()`) and must not permanently
 * consume the single-send guard — a later delivery attempt still sends the
 * SDP exactly once.
 *
 * `sendZeroHubMessage` used to guard only on `isDisconnected` / `!ws` and
 * then called `ws.send()` directly: on a CONNECTING (or CLOSING) socket the
 * browser throws `InvalidStateError`, which escaped out of the
 * `onicecandidate` / ICE-timeout event handlers AND — worse, in
 * `armSendOnIceReady` — `isSent` was set to `true` BEFORE `sendOnce()` ran,
 * so the single-send guard was consumed by the failed attempt and the peer
 * stalled in Pending/Offering forever with no retry.
 *
 * The fix:
 *  1. `sendZeroHubMessage` treats "socket present but not OPEN" as a
 *     first-class state and throws a clean typed error instead of letting
 *     `ws.send` throw `InvalidStateError`.
 *  2. `armSendOnIceReady` wraps `sendOnce` (and the trickle candidate send)
 *     in try/catch and only sets `isSent` after delivery succeeds, so a
 *     failed attempt on a non-OPEN socket leaves the guard open: a later
 *     candidate (or the ICE-timeout fallback) still delivers the SDP
 *     exactly once.
 *
 * Scenario driven here (the realistic field case):
 *   1. Initial connect: socket #1 against host `a`.
 *   2. An offer is armed with a short ICE window; no candidates ever arrive
 *      on the mock connection, so the fallback timer is the delivery path.
 *   3. Inside the ICE window the socket drops (code 1006): the client
 *      auto-reconnects to host `b`. The spec explicitly marks the new mock
 *      socket as CONNECTING (`markSocketConnecting`) so signaling sends are
 *      refused while the handshake is "in flight".
 *   4. The ICE timer fires while socket #2 is still CONNECTING: the SDP
 *      send must NOT throw out of the timer callback and must NOT consume
 *      the single-send guard.
 *   5. The reconnect completes (`captureSocket` opens + captures the new
 *      socket); a late ICE candidate then delivers the offer exactly once
 *      and trickles itself.
 *
 * Runs without a server or real WebRTC: the client is bundled with the unit
 * harness (mocked `WebSocket`, mocked `RTCPeerConnection`, no-op topology)
 * and driven through `window.ZeroHubUnitHarness`.
 */

type Send = {
  kind: "offer" | "answer" | "iceCandidate";
  peerId: string;
  sdp?: string;
  candidate?: string;
};

/** The in-page driver surface (window.ZeroHubUnitHarness). */

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
    markSocketConnecting: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.markSocketConnecting(id), id),
    openSocket: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.openSocket(id), id),
    fireIceCandidate: (id: number, peerId: string, candidate: unknown) =>
      page.evaluate(
        ([id, peerId, candidate]) =>
          ZeroHubUnitHarness.fireIceCandidate(id, peerId, candidate),
        [id, peerId, candidate] as const,
      ),
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

test.describe("ZeroHubClient SDP send across the reconnect CONNECTING window", () => {
  test("an ICE-timeout send on a CONNECTING socket does not throw and a later candidate delivers the offer exactly once", async ({
    page,
  }) => {
    await prepareUnitHarnessPage(page);
    const h = driver(page);

    // Two hosts so the 1006 abnormal close auto-fails over to host `b`
    // (a single-host client would surface a terminal error instead).
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

    // Arm the offer with a short ICE window: no ICE candidates ever arrive
    // on the mock connection, so the fallback timer is the only thing that
    // will attempt the SDP send.
    const ICE_TIMEOUT_MS = 300;
    await h.setWaitIceTimeout(id, ICE_TIMEOUT_MS);
    await h.invokeSendOffer(id, "2");

    // Within the ICE window the signaling socket drops: code 1006 triggers
    // the automatic reconnect to host `b`. The new mock socket #2 starts in
    // the CONNECTING state (the handshake has not completed) and STAYS
    // there until the spec models it completing via `captureSocket`.
    await h.simulateAbnormalClose(id);
    await flushMicrotasks(page);
    expect(await h.getSocketCount(id)).toBe(2);
    expect(await h.getLastSocketUrl(id)).toBe(
      "wss://b.zerohub.dev/v1/hubs/create?id=room",
    );
    // Model the reconnection handshake as still in flight: the new mock
    // socket is CONNECTING, so every signaling send to it is refused
    // (browser `InvalidStateError` from `ws.send()` territory) until
    // `captureSocket` opens it below.
    await h.markSocketConnecting(id);

    await test.step("the ICE-timeout fires on a CONNECTING socket without throwing out of the timer callback", async () => {
      // Past the ICE window: the fallback timer has fired while socket #2
      // was still CONNECTING. Before the fix, this path set `isSent = true`
      // and then threw `InvalidStateError` out of the timer callback — an
      // uncaught exception AND a permanently consumed single-send guard.
      // The mock `ws.send` on a CONNECTING socket throws a real
      // `InvalidStateError` DOMException, exactly like the browser.
      await page.waitForTimeout(ICE_TIMEOUT_MS + 200);
      // The page is still alive and nothing was delivered: the attempt was
      // refused, logged, and the guard stayed open.
      expect(await h.getSends(id)).toHaveLength(0);
    });

    await test.step("a later candidate delivers the offer exactly once on the OPEN socket", async () => {
      // The reconnect completes: the harness opens the socket (readyState
      // OPEN) and starts capturing its sends.
      await h.captureSocket(id);
      await h.fireIceCandidate(id, "2", {
        candidate: "candidate:1 1 udp 2122252543 1.2.3.4 5678 typ host",
      });
      await page.waitForTimeout(30);

      const sends = (await h.getSends(id)) as Send[];
      // The SDP went out EXACTLY ONCE — the failed CONNECTING attempt did
      // not consume the single-send guard — plus the trickled candidate.
      const sdpSends = sends.filter((s) => s.kind !== "iceCandidate");
      expect(sdpSends).toHaveLength(1);
      expect(sdpSends[0].kind).toBe("offer");
      expect(sdpSends[0].peerId).toBe("2");
      expect(sdpSends[0].sdp).toBe("offer-sdp");
      const candidates = sends.filter((s) => s.kind === "iceCandidate");
      expect(candidates).toHaveLength(1);
      expect(candidates[0].peerId).toBe("2");
    });

    await test.step("subsequent events do not re-send the SDP", async () => {
      await h.fireIceCandidate(id, "2", null); // gathering-complete marker
      await h.fireIceCandidate(id, "2", {
        candidate: "candidate:2 1 udp 184549489 5.6.7.8 9010 typ srflx raddr 0.0.0.0 rport 0",
      });
      await page.waitForTimeout(30);
      const sends = (await h.getSends(id)) as Send[];
      expect(sends.filter((s) => s.kind !== "iceCandidate")).toHaveLength(1);
      expect(sends.filter((s) => s.kind === "iceCandidate")).toHaveLength(2);
    });
  });

  test("an ICE candidate fired while the socket is CONNECTING does not throw and does not permanently block delivery", async ({
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

    // Long ICE window so the fallback timer cannot interfere: the
    // onicecandidate path is the only delivery attempt in this test.
    await h.setWaitIceTimeout(id, 30_000);
    await h.invokeSendOffer(id, "2");

    // The signaling socket drops; the client auto-reconnects to host `b`,
    // leaving socket #2 in the CONNECTING state (the mock defaults to
    // OPEN, so this is modeled explicitly).
    await h.simulateAbnormalClose(id);
    await flushMicrotasks(page);
    expect(await h.getSocketCount(id)).toBe(2);
    await h.markSocketConnecting(id);

    await test.step("the first candidate, fired on a CONNECTING socket, does not throw out of onicecandidate", async () => {
      // Before the fix, this call threw an `InvalidStateError` out of the
      // event handler (the mock `ws.send` refuses non-OPEN sockets exactly
      // like the browser) AND set `isSent = true`, so no later candidate
      // could ever deliver the SDP.
      await h.fireIceCandidate(id, "2", {
        candidate: "candidate:1 1 udp 2122252543 1.2.3.4 5678 typ host",
      });
      // The candidate itself was logged as dropped (no capture attached yet),
      // the handler survived, and nothing was delivered.
      expect(await h.getSends(id)).toHaveLength(0);
    });

    await test.step("after the socket opens, the next candidate delivers the offer exactly once", async () => {
      await h.captureSocket(id); // models the handshake completing
      await h.fireIceCandidate(id, "2", {
        candidate: "candidate:2 1 udp 184549489 5.6.7.8 9010 typ srflx raddr 0.0.0.0 rport 0",
      });
      await page.waitForTimeout(30);

      const sends = (await h.getSends(id)) as Send[];
      const sdpSends = sends.filter((s) => s.kind !== "iceCandidate");
      expect(sdpSends).toHaveLength(1);
      expect(sdpSends[0].kind).toBe("offer");
      expect(sdpSends[0].peerId).toBe("2");
      expect(sdpSends[0].sdp).toBe("offer-sdp");
      const candidates = sends.filter((s) => s.kind === "iceCandidate");
      expect(candidates).toHaveLength(1);
      expect(candidates[0].peerId).toBe("2");
      expect(candidates[0].candidate).toContain("candidate:2");
    });

    await test.step("the single-send guard is now closed: no further SDP sends", async () => {
      await h.fireIceCandidate(id, "2", null);
      await page.waitForTimeout(30);
      const sends = (await h.getSends(id)) as Send[];
      expect(sends.filter((s) => s.kind !== "iceCandidate")).toHaveLength(1);
    });
  });
});

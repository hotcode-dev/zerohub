import { test, expect, Page } from "@playwright/test";
import { prepareUnitHarnessPage } from "./utils/unit-harness";

/**
 * Regression tests: the multi-host reconnect sweep must survive outages
 * instead of giving up after one pass through the configured host list.
 *
 * Before the fix, a logical failure advanced `hostIndex` at most once and,
 * once the last host had no backup, fired the terminal `onZeroHubError` —
 * so a transient outage lasting longer than one pass through the list
 * permanently killed a long-lived session. After the fix:
 *
 *  - EVERY host (at any position in the configured list, or a
 *    migration-redirect target) retries the SAME host on an abnormal
 *    1006/1011 close, with exponential backoff, up to
 *    `maxReconnectAttempts` times before moving on;
 *  - when the LAST host's budget is spent, the sweep WRAPS back to the
 *    first host (bounded by `maxReconnectRounds` sweeps);
 *  - only when every host's budget is spent on every allowed sweep does
 *    the terminal `onZeroHubError` fire — exactly once, and the client
 *    latches (`reconnectAbandoned`) so a further blip on a leftover
 *    socket is a no-op instead of re-firing the error or re-dialing.
 *
 * These specs drive the REAL `connectToZeroHub` (no stub) through a fake
 * `WebSocket` global installed by the unit harness
 * (`installFakeWebSocket()`), which settles each dial as a connection
 * refusal (`onclose` 1006, exactly what a refused dial's close event is
 * in a browser) or a completed handshake (`onopen`) depending on which
 * hosts the spec marked healthy — no real servers or dead ports needed.
 * The fake state lives in-page, so every control call runs through a
 * `page.evaluate` on `ZeroHubUnitHarness`.
 */

/**
 * The in-page driver surface (window.ZeroHubUnitHarness). `ZeroHubUnitHarness`
 * is a global installed by the harness's init script, so every call runs
 * inline in the page and only primitive arguments (ids, strings, booleans)
 * are serialized across the boundary — never the harness handle itself
 * (Playwright serializes evaluate arguments and rejects non-serializable
 * values like function-bearing objects).
 */
function driver(page: Page) {
  return {
    installFakeWebSocket: () =>
      page.evaluate(() => ZeroHubUnitHarness.installFakeWebSocket()),
    markHealthy: (host: string) =>
      page.evaluate((host) => ZeroHubUnitHarness.markFakeWebSocketHealthy(host), host),
    markDead: (host: string) =>
      page.evaluate((host) => ZeroHubUnitHarness.markFakeWebSocketDead(host), host),
    settleOpen: () => page.evaluate(() => ZeroHubUnitHarness.settleOpen()),
    fireLiveClose: (code: number, reason: string) =>
      page.evaluate(
        ([code, reason]) => ZeroHubUnitHarness.fireLiveClose(code, reason),
        [code, reason] as const,
      ),
    getDials: () => page.evaluate(() => ZeroHubUnitHarness.getFakeDials()),
    teardownFake: () =>
      page.evaluate(() => ZeroHubUnitHarness.teardownFakeWebSocket()),
    createClient: (hosts: string[]) =>
      page.evaluate(
        (hostList) => ZeroHubUnitHarness.createClientWithHosts(hostList),
        hosts,
      ),
    createHub: (id: number, hubId: string) =>
      page.evaluate(
        ([id, hubId]) => ZeroHubUnitHarness.createHub(id, hubId),
        [id, hubId] as const,
      ),
    setConfig: (id: number, overrides: Record<string, unknown>) =>
      page.evaluate(
        ([id, overrides]) => ZeroHubUnitHarness.setConfig(id, overrides),
        [id, overrides] as const,
      ),
    captureZeroHubErrors: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.captureZeroHubErrors(id), id),
    getZeroHubErrorMessages: (id: number) =>
      page.evaluate(
        (id) => ZeroHubUnitHarness.getZeroHubErrorMessages(id),
        id,
      ),
    getReconnectAttempts: (id: number) =>
      page.evaluate(
        (id) => ZeroHubUnitHarness.getReconnectAttempts(id),
        id,
      ),
    getReconnectRound: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.getReconnectRound(id), id),
    getHostIndex: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.getHostIndex(id), id),
    getHost: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.getHost(id), id),
    sendHubInfoOnSocket: (id: number, hubId: string, myPeerId: string) =>
      page.evaluate(
        ([id, hubId, myPeerId]) =>
          ZeroHubUnitHarness.sendHubInfoOnSocket(id, hubId, myPeerId),
        [id, hubId, myPeerId] as const,
      ),
    wait: (ms: number) => page.evaluate((ms) => ZeroHubUnitHarness.wait(ms), ms),
  };
}

/** The terminal all-hosts-exhausted error message. */
const TERMINAL_ERROR =
  "all ZeroHub hosts are not working, please check the ZeroHub hosts";

/**
 * Comfortably past the worst-case backoff of an attempt-#1 same-host retry.
 * Base 250 ms with ±20% jitter (200–300 ms); every retry scheduled in these
 * specs is attempt #1 (each host's budget of 1 refills on every hop), so
 * the worst case is the same.
 */
const WAIT_AFTER_ATTEMPT_1_MS = 450;

/**
 * Starts a session on the first host through the fake WebSocket: the first
 * host is healthy, the entry point's dial settles on its onopen, and the
 * server's hub info confirms the connection.
 */
async function startSession(
  h: ReturnType<typeof driver>,
  id: number,
  firstHost: string
) {
  await h.markHealthy(firstHost);
  await h.createHub(id, "room"); // dial #1 (pending, CONNECTING)
  await h.settleOpen(); // onopen -> entry point resolves
  await h.sendHubInfoOnSocket(id, "room", "1");
}

test.describe("ZeroHubClient multi-host reconnect sweep (fake WebSocket)", () => {
  test("a transient blip on the FIRST host retries the SAME host with backoff and recovers without advancing hostIndex", async ({
    page,
  }) => {
    await prepareUnitHarnessPage(page);
    const h = driver(page);
    await h.installFakeWebSocket();
    const id = await h.createClient(["a.example", "b.example"]);
    await h.captureZeroHubErrors(id);

    await startSession(h, id, "a.example");
    expect(await h.getHostIndex(id)).toBe(0);
    expect(await h.getHost(id)).toBe("a.example");

    await test.step("the blip: a drops, the FIRST retry must re-dial a, not b", async () => {
      // a is down: the live socket closes 1006.
      await h.markDead("a.example");
      await h.fireLiveClose(1006, "");

      // No failover yet: a's same-host retry is pending behind backoff,
      // hostIndex untouched, no terminal error.
      await h.wait(50);
      expect(await h.getHostIndex(id)).toBe(0);
      expect(await h.getReconnectAttempts(id)).toBe(1);
      expect(await h.getZeroHubErrorMessages(id)).toHaveLength(0);
      expect(await h.getDials()).toHaveLength(1);

      // a recovers during the backoff window: the retry re-dials a.
      await h.markHealthy("a.example");
      await h.wait(WAIT_AFTER_ATTEMPT_1_MS);
      const dials = await h.getDials();
      expect(dials).toHaveLength(2);
      expect(dials[1]).toContain("a.example");
      await h.settleOpen(); // onopen

      // The server confirms the recovered session; hostIndex still 0.
      await h.sendHubInfoOnSocket(id, "room", "1");
      expect(await h.getHostIndex(id)).toBe(0);
      expect(await h.getHost(id)).toBe("a.example");
      expect(await h.getReconnectAttempts(id)).toBe(0);
      expect(await h.getZeroHubErrorMessages(id)).toHaveLength(0);
    });

    await h.teardownFake();
  });

  test("two down hosts + one healthy host: the client recovers by sweep instead of the terminal error", async ({
    page,
  }) => {
    await prepareUnitHarnessPage(page);
    const h = driver(page);
    await h.installFakeWebSocket();
    const id = await h.createClient([
      "down1.example",
      "down2.example",
      "up.example",
    ]);
    await h.captureZeroHubErrors(id);
    // Tight budgets so the sweep finishes in-test.
    await h.setConfig(id, { maxReconnectAttempts: 1, maxReconnectRounds: 2 });

    await test.step("initial connection: failover walks past the two dead hosts", async () => {
      // down1 and down2 are dead at t=0; the entry point's dial (down1) is
      // refused and the initial-connection failover walks to down2 (dead)
      // and finally up (healthy) — each hop immediate, no same-host retry.
      await h.markDead("down1.example");
      await h.markDead("down2.example");
      await h.markHealthy("up.example");
      await h.createHub(id, "room"); // dial #1: down1 (pending)
      await h.settleOpen(); // down1 refusal -> failover dial #2: down2
      await h.settleOpen(); // down2 refusal -> failover dial #3: up
      await h.settleOpen(); // up: onopen -> session established
      expect(await h.getHostIndex(id)).toBe(2);
      expect(await h.getHost(id)).toBe("up.example");
      await h.sendHubInfoOnSocket(id, "room", "1");
      expect(await h.getZeroHubErrorMessages(id)).toHaveLength(0);
    });

    await test.step("the outage hits EVERY host: the sweep wraps instead of dying", async () => {
      // The whole region loses connectivity: all three hosts go down and
      // the live socket (up) drops.
      await h.markDead("up.example");
      await h.fireLiveClose(1006, "");

      // up is the last host: same-host retry #1 (budget 1) re-dials up…
      await h.wait(WAIT_AFTER_ATTEMPT_1_MS); // retry dial #4: up
      await h.settleOpen(); // up refusal -> reconnect
      // …its budget is now spent: the sweep WRAPS to the first host
      // instead of firing the terminal error (immediate dial #5: down1).
      expect(await h.getDials()).toHaveLength(5);
      expect(await h.getHostIndex(id)).toBe(0);
      expect(await h.getReconnectRound(id)).toBe(1);
      expect(await h.getZeroHubErrorMessages(id)).toHaveLength(0);

      // down1 refuses too; its own budget (1) schedules a same-host
      // retry (#6)…
      await h.settleOpen(); // down1 refusal -> same-host retry queued
      await h.wait(WAIT_AFTER_ATTEMPT_1_MS);
      await h.settleOpen(); // down1 retry refusal -> budget spent
      // …and being the FIRST host (not the last), a spent budget fails
      // over to the next host — down2 — instead of wrapping (dial #7).
      await h.markHealthy("down2.example"); // the outage clears mid-sweep
      await h.settleOpen(); // down2: onopen
      await h.sendHubInfoOnSocket(id, "room", "1");
      expect(await h.getHost(id)).toBe("down2.example");
      expect(await h.getHostIndex(id)).toBe(1);
      expect(await h.getReconnectRound(id)).toBe(0); // confirmed connection
      expect(await h.getZeroHubErrorMessages(id)).toHaveLength(0);
    });

    await h.teardownFake();
  });

  test("the terminal error fires exactly once after the whole sweep budget is exhausted", async ({
    page,
  }) => {
    await prepareUnitHarnessPage(page);
    const h = driver(page);
    await h.installFakeWebSocket();
    const id = await h.createClient(["a.example", "b.example"]);
    await h.captureZeroHubErrors(id);
    await h.setConfig(id, { maxReconnectAttempts: 1, maxReconnectRounds: 1 });
    await startSession(h, id, "a.example");

    // Total outage: both hosts down, live socket (a) drops.
    await h.markDead("a.example");
    await h.markDead("b.example");
    await h.fireLiveClose(1006, "");

    // Sweep with budgets of 1 and one allowed wraparound round:
    //   a retry (dial #2) -> failover b (#3) -> b retry (#4) ->
    //   wrap to a (round 1, #5) -> a retry (#6) -> failover b (#7) ->
    //   b retry (#8) -> rounds exhausted -> terminal.
    await h.wait(WAIT_AFTER_ATTEMPT_1_MS); // a retry, dial #2
    await h.settleOpen(); // a retry refusal -> failover b (dial #3)
    await h.settleOpen(); // b refusal -> b retry queued
    await h.wait(WAIT_AFTER_ATTEMPT_1_MS); // b retry, dial #4
    await h.settleOpen(); // b retry refusal -> wrap to a (dial #5, round 1)
    await h.settleOpen(); // a refusal -> a retry queued
    await h.wait(WAIT_AFTER_ATTEMPT_1_MS); // a retry, dial #6
    await h.settleOpen(); // a retry refusal -> failover b (dial #7)
    await h.settleOpen(); // b refusal -> b retry queued
    await h.wait(WAIT_AFTER_ATTEMPT_1_MS); // b retry, dial #8
    await h.settleOpen(); // b retry refusal -> terminal

    // The whole sweep budget is spent: the terminal error fires — exactly
    // once, with the pinned message.
    await h.wait(100);
    const errors = await h.getZeroHubErrorMessages(id);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBe(TERMINAL_ERROR);

    // And it does not fire a second time on a further blip: the client
    // latched `reconnectAbandoned`, so the close is a no-op — no further
    // dials happen.
    const dialsBefore = await h.getDials();
    await h.fireLiveClose(1006, "");
    await h.wait(100);
    expect(await h.getDials()).toHaveLength(dialsBefore.length);
    expect(await h.getZeroHubErrorMessages(id)).toHaveLength(1);

    await h.teardownFake();
  });
});

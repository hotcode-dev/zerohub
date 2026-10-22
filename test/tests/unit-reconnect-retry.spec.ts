import { test, expect, Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Regression test: a single-host client (the default deployment — `new
 * ZeroHubClient(["localhost:8080"], ...)`) must NOT permanently give up
 * auto-reconnection after ONE transient abnormal WebSocket close (code 1006
 * abnormal close, or 1011 internal error). Before the fix,
 * `getZeroHubBackupHost()` rejected the moment `hostIndex` was already at
 * the last host, so the very first 1006/1011 close abandoned reconnection
 * forever: a dead `ws`, no signaling, and no path back for the lifetime of
 * the `ZeroHubClient` instance — even though the host was healthy. The
 * documented contract (client README, "Reconnection & host failover") says
 * reconnect is automatic on unexpected close.
 *
 * After the fix, an abnormal close on the LAST configured host schedules a
 * SAME-HOST retry with exponential backoff + jitter (default budget 10
 * attempts, 250 ms base, each doubling, capped at 30 s). The terminal
 * `onZeroHubError` fires only after that budget is genuinely exhausted
 * (deferred `zf-z-6d960008` behavior, preserved), and the retry budget
 * resets to zero once a connection is confirmed (the server's hub info
 * arrives) — so a long-lived healthy session never accumulates backoff.
 *
 * Runs without a server or real WebRTC: the client is bundled with the unit
 * harness (mocked `WebSocket`, mocked `RTCPeerConnection`, no-op topology)
 * and driven through `window.ZeroHubUnitHarness`.
 *
 * Covers:
 *  1. A single 1006 close on the only host re-dials the SAME host after the
 *     backoff delay — no host skip, no terminal error, `hostIndex`
 *     untouched; the server's hub info on the recovered socket confirms the
 *     session and resets the retry budget.
 *  2. A blip STORM (budget-many abnormal closes) keeps dialing the same
 *     host the whole time with the attempt counter rising, and the terminal
 *     error surfaces exactly once — only after the retry budget is spent.
 *  3. A confirmed connection on the re-dialed socket resets the retry
 *     budget, so the next blip gets a full budget: transient blips on a
 *     long-lived session never accumulate into exhaustion.
 *  4. A manual `disconnect()` with a retry queued cancels it: no stray
 *     socket, no resurrection of the disconnected client.
 */

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
    createClient: () =>
      page.evaluate(() => ZeroHubUnitHarness.createClient()),
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
    getHostIndex: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.getHostIndex(id), id),
    getSocketCount: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.getSocketCount(id), id),
    getLastSocketUrl: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.getLastSocketUrl(id), id),
    simulateAbnormalClose: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.simulateAbnormalClose(id), id),
    sendHubInfoOnSocket: (id: number, hubId: string, myPeerId: string) =>
      page.evaluate(
        ([id, hubId, myPeerId]) =>
          ZeroHubUnitHarness.sendHubInfoOnSocket(id, hubId, myPeerId),
        [id, hubId, myPeerId] as const,
      ),
    wait: (ms: number) => page.evaluate((ms) => ZeroHubUnitHarness.wait(ms), ms),
    disconnectClient: (id: number) =>
      page.evaluate((id) => ZeroHubUnitHarness.disconnectClient(id), id),
  };
}

/**
 * The initial socket URL for the single-host client's `createHub("room")`:
 * the unit harness's `createClient` builds the client with `tls` unset, and
 * the default config has `tls: true` — so it is a plain `wss://` URL.
 */
const SINGLE_HOST_URL = "wss://localhost:1/v1/hubs/create?id=room";

/** The terminal all-hosts-exhausted error message. */
const TERMINAL_ERROR =
  "all ZeroHub hosts are not working, please check the ZeroHub hosts";

/**
 * Comfortably past the N-th retry's worst-case backoff. Base 250 ms doubles
 * each attempt with ±20% jitter; these cumulative floors keep every
 * assertion deterministic under real timers.
 */
const WAIT_AFTER_ATTEMPT_1_MS = 400;
const WAIT_AFTER_ATTEMPT_2_MS = 1000;
const WAIT_AFTER_ATTEMPT_3_MS = 3200;

test.describe("ZeroHubClient same-host retry-with-backoff on abnormal close", () => {
  test("a single 1006 close on the only host retries the SAME host, not a host skip, not give-up", async ({
    page,
  }) => {
    await prepareUnitHarnessPage(page);
    const h = driver(page);
    const id = await h.createClient();
    await h.createHub(id, "room");
    expect(await h.getLastSocketUrl(id)).toBe(SINGLE_HOST_URL);

    // Spy on onZeroHubError BEFORE the blip: the only error that may ever
    // matter for the assertions is a premature terminal one.
    await h.captureZeroHubErrors(id);

    // The transient blip: the network drops while the host is healthy.
    await h.simulateAbnormalClose(id);

    await test.step("the first blip does NOT surface a terminal error", async () => {
      // Synchronously after the close, no terminal error may have fired:
      // the retry is deferred behind the backoff timer, and the budget
      // (10 by default) still has 10 attempts left.
      await h.wait(50);
      expect(await h.getZeroHubErrorMessages(id)).toHaveLength(0);
      expect(await h.getReconnectAttempts(id)).toBe(1);
      expect(await h.getHostIndex(id)).toBe(0);
    });

    await test.step("the retry dials the SAME host after the backoff delay", async () => {
      await h.wait(WAIT_AFTER_ATTEMPT_1_MS);
      expect(await h.getSocketCount(id)).toBe(2);
      expect(await h.getLastSocketUrl(id)).toBe(SINGLE_HOST_URL);
      expect(await h.getZeroHubErrorMessages(id)).toHaveLength(0);
    });

    await test.step("the server's hub info on the recovered socket resets the retry budget", async () => {
      // The server confirms the recovered connection with its hub info,
      // exactly what a healthy server does on (re)connect.
      await h.sendHubInfoOnSocket(id, "room", "1");
      expect(await h.getReconnectAttempts(id)).toBe(0);
      expect(await h.getZeroHubErrorMessages(id)).toHaveLength(0);
    });
  });

  test("a blip storm keeps retrying the same host until the budget is spent, then surfaces the terminal error exactly once", async ({
    page,
  }) => {
    await prepareUnitHarnessPage(page);
    const h = driver(page);
    const id = await h.createClient();
    // Shrink the budget so the terminal error is reachable in a test:
    // total backoff for 3 retries stays well under the test timeout.
    await h.setConfig(id, { maxReconnectAttempts: 3 });
    await h.createHub(id, "room");
    expect(await h.getLastSocketUrl(id)).toBe(SINGLE_HOST_URL);
    await h.captureZeroHubErrors(id);

    await test.step("each of the first three blips re-dials the SAME host", async () => {
      // Blip #1: queues retry attempt 1 (backoff ~250 ms).
      await h.simulateAbnormalClose(id);
      await h.wait(WAIT_AFTER_ATTEMPT_1_MS);
      expect(await h.getLastSocketUrl(id)).toBe(SINGLE_HOST_URL);
      expect(await h.getReconnectAttempts(id)).toBe(1);

      // Blip #2: queues retry attempt 2 (backoff ~500 ms).
      await h.simulateAbnormalClose(id);
      await h.wait(WAIT_AFTER_ATTEMPT_2_MS);
      expect(await h.getLastSocketUrl(id)).toBe(SINGLE_HOST_URL);
      expect(await h.getReconnectAttempts(id)).toBe(2);

      // Blip #3: queues retry attempt 3 (backoff ~1000 ms) — the last one
      // in the budget.
      await h.simulateAbnormalClose(id);
      await h.wait(WAIT_AFTER_ATTEMPT_3_MS);
      expect(await h.getLastSocketUrl(id)).toBe(SINGLE_HOST_URL);
      expect(await h.getReconnectAttempts(id)).toBe(3);
      expect(await h.getZeroHubErrorMessages(id)).toHaveLength(0);
    });

    await test.step("the budget is exhausted: one more close is terminal", async () => {
      // The third retry's timer has already dialed the (mock) socket back;
      // the NEXT abnormal close finds no budget left and falls through to
      // getZeroHubBackupHost(), which rejects — the terminal error.
      await h.simulateAbnormalClose(id);
      await page.waitForTimeout(200);
      const errors = await h.getZeroHubErrorMessages(id);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toBe(TERMINAL_ERROR);
    });
  });

  test("a confirmed connection on the re-dialed socket resets the retry budget", async ({
    page,
  }) => {
    await prepareUnitHarnessPage(page);
    const h = driver(page);
    const id = await h.createClient();
    await h.setConfig(id, { maxReconnectAttempts: 3 });
    await h.createHub(id, "room");
    await h.captureZeroHubErrors(id);

    // A single transient blip; the retry dials the same host back.
    await h.simulateAbnormalClose(id);
    await h.wait(WAIT_AFTER_ATTEMPT_1_MS);
    expect(await h.getReconnectAttempts(id)).toBe(1);

    // The server confirms the recovered connection.
    await h.sendHubInfoOnSocket(id, "room", "1");
    expect(await h.getReconnectAttempts(id)).toBe(0);

    await test.step("the next blip gets a FULL budget, not the remainder", async () => {
      // Without the reset, the budget would have 2 attempts left here;
      // with it, 3. Drive 3 blips: every one must retry the same host,
      // and the terminal error must NOT fire (4 blips would be needed).
      for (let i = 0; i < 3; i += 1) {
        await h.simulateAbnormalClose(id);
        await h.wait(
          i === 0
            ? WAIT_AFTER_ATTEMPT_1_MS
            : i === 1
              ? WAIT_AFTER_ATTEMPT_2_MS
              : WAIT_AFTER_ATTEMPT_3_MS
        );
        expect(await h.getLastSocketUrl(id)).toBe(SINGLE_HOST_URL);
        expect(await h.getReconnectAttempts(id)).toBe(i + 1);
      }
      expect(await h.getZeroHubErrorMessages(id)).toHaveLength(0);
    });
  });

  test("a manual disconnect() with a retry queued cancels it: no stray socket, no resurrection", async ({
    page,
  }) => {
    await prepareUnitHarnessPage(page);
    const h = driver(page);
    const id = await h.createClient();
    await h.createHub(id, "room");
    const socketsBefore = await h.getSocketCount(id);

    // A blip queues a same-host retry behind the backoff timer.
    await h.simulateAbnormalClose(id);
    await h.wait(50);
    expect(await h.getReconnectAttempts(id)).toBe(1);

    // The user gives up: manual teardown must cancel the queued retry.
    await h.disconnectClient(id);
    expect(await h.getReconnectAttempts(id)).toBe(0);

    await test.step("the pending retry does not dial a stray socket after teardown", async () => {
      await h.wait(WAIT_AFTER_ATTEMPT_1_MS);
      expect(await h.getSocketCount(id)).toBe(socketsBefore);
    });
  });
});

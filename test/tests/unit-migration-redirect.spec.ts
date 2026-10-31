import { test, expect } from "@playwright/test";
import { prepareUnitHarnessPage } from "./utils/unit-harness";

/**
 * Regression test: a server-side migration redirect (close code 1001 with
 * the backup host in the close reason) must update the client's internal
 * `host` / `hostIndex` state, not just the URL it is passed.
 *
 * `reconnect(url, newHost)` used to set only `currentURL.host`. Every
 * public entry point (`createHub`, `joinHub`, ...) builds its URL from
 * `this.host` (`openHubConnection`), so after a migration redirect the next
 * entry-point call dialed the OLD (still-migrating or shut-down) host
 * instead of the redirected one. This spec pins:
 *
 *  1. After a 1001 + reason close, `this.host` equals the redirect host and
 *     a subsequent `joinHub()` opens a socket against it (not the old host).
 *  2. When the redirect host is in the configured host list, `hostIndex`
 *     moves to its position, so a following 1006 automatic failover starts
 *     from the redirected host instead of a stale position.
 *
 * Runs without a server or real WebRTC: the client is bundled with the unit
 * harness (mocked `WebSocket`, mocked `RTCPeerConnection`, no-op topology)
 * and driven through `window.ZeroHubUnitHarness`.
 */

/** The in-page driver surface (window.ZeroHubUnitHarness). */

test("migration redirect (1001 + reason) updates host state for the next entry point", async ({
  page,
}) => {
  await prepareUnitHarnessPage(page);

  const id = await page.evaluate(
    () => ZeroHubUnitHarness.createClientWithHosts(["a.zerohub.dev", "b.zerohub.dev"])
  );

  // Initial connection entry point: socket #1 opens against host `a`.
  await page.evaluate((clientId) => ZeroHubUnitHarness.createHub(clientId, "room"), id);
  expect(await page.evaluate((clientId) => ZeroHubUnitHarness.getLastSocketUrl(clientId), id)).toBe(
    "wss://a.zerohub.dev/v1/hubs/create?id=room"
  );

  // Operator migrates server A: the live socket is closed with code 1001
  // and the backup host in the reason (server `ForwardMigrate` behavior).
  await page.evaluate(
    (clientId) => ZeroHubUnitHarness.simulateMigrationClose(clientId, "b.zerohub.dev"),
    id
  );

  // The redirect branch must have moved the client's host state.
  expect(await page.evaluate((clientId) => ZeroHubUnitHarness.getHost(clientId), id)).toBe(
    "b.zerohub.dev"
  );

  // The redirected reconnect dialed host `b`.
  expect(await page.evaluate((clientId) => ZeroHubUnitHarness.getLastSocketUrl(clientId), id)).toBe(
    "wss://b.zerohub.dev/v1/hubs/create?id=room"
  );

  // The next entry-point call builds its URL from the UPDATED host, not the
  // stale one: it must open against `b.zerohub.dev`, never the old `a`.
  await page.evaluate((clientId) => ZeroHubUnitHarness.joinHub(clientId, "room"), id);
  expect(await page.evaluate((clientId) => ZeroHubUnitHarness.getLastSocketUrl(clientId), id)).toBe(
    "wss://b.zerohub.dev/v1/hubs/join?id=room"
  );
});

test("migration redirect to a configured host starts automatic failover from that position", async ({
  page,
}) => {
  await prepareUnitHarnessPage(page);

  const id = await page.evaluate(
    () => ZeroHubUnitHarness.createClientWithHosts(["a.zerohub.dev", "b.zerohub.dev"])
  );
  // Shrink the retry budget so the wraparound is reachable in-test.
  await page.evaluate(
    (clientId) =>
      ZeroHubUnitHarness.setConfig(clientId, { maxReconnectAttempts: 1 }),
    id
  );
  await page.evaluate((clientId) => ZeroHubUnitHarness.createHub(clientId, "room"), id);

  // Redirect from `a` to `b`: hostIndex must land on `b`'s position (1).
  await page.evaluate(
    (clientId) => ZeroHubUnitHarness.simulateMigrationClose(clientId, "b.zerohub.dev"),
    id
  );
  expect(await page.evaluate((clientId) => ZeroHubUnitHarness.getHostIndex(clientId), id)).toBe(1);

  // Now the (mocked) connection to `b` dies with an abnormal 1006. The
  // redirect moved the client to a fresh host and ended the
  // initial-connection phase, so the close takes the RECONNECT path:
  // `b` gets its (single) same-host retry first (hostIndex stays on `b`'s
  // position, not a stale one)…
  await page.evaluate((clientId) => ZeroHubUnitHarness.simulateAbnormalClose(clientId), id);
  await page.waitForTimeout(400); // attempt-#1 backoff (250 ms base ±20%)
  // …the retry re-dials `b` (the redirected host), not the old one.
  expect(await page.evaluate((clientId) => ZeroHubUnitHarness.getHost(clientId), id)).toBe(
    "b.zerohub.dev"
  );
  expect(await page.evaluate((clientId) => ZeroHubUnitHarness.getLastSocketUrl(clientId), id)).toBe(
    "wss://b.zerohub.dev/v1/hubs/create?id=room"
  );

  // …and only when that retry budget is spent does the sweep move on:
  // `b` is the LAST configured host (index 1 of 2), so the wraparound
  // sweep goes back to the FIRST configured host `a` instead of staying
  // put or hopping a stale index.
  await page.evaluate((clientId) => ZeroHubUnitHarness.simulateAbnormalClose(clientId), id);
  // The wraparound re-dial settles synchronously; flush microtasks.
  await page.evaluate(async () => {
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });

  // The sweep wrapped to the first host: hostIndex reset to 0, host is `a`,
  // and a fresh socket was opened against `a`.
  expect(await page.evaluate((clientId) => ZeroHubUnitHarness.getHost(clientId), id)).toBe(
    "a.zerohub.dev"
  );
  expect(await page.evaluate((clientId) => ZeroHubUnitHarness.getHostIndex(clientId), id)).toBe(0);
  expect(await page.evaluate((clientId) => ZeroHubUnitHarness.getLastSocketUrl(clientId), id)).toBe(
    "wss://a.zerohub.dev/v1/hubs/create?id=room"
  );
});

test("migration redirect to a host OUTSIDE the list that flaps once recovers on the backup host", async ({
  page,
}) => {
  // The common operator flow: /admin/migrate points at a NEW instance whose
  // address is not in the client's configured host list. The client must
  // follow the server-directed host, keep it when it flaps (1006 blip), and
  // recover there — instead of the pre-fix dead end where a later blip
  // advanced the STALE hostIndex back onto the old hosts (which, in migrate
  // mode, redirect back to the new host until the "redirect target is the
  // current host, not retrying" terminal error fires even though the backup
  // host may come back seconds later).
  await prepareUnitHarnessPage(page);

  const id = await page.evaluate(
    () => ZeroHubUnitHarness.createClientWithHosts(["a.zerohub.dev"])
  );
  await page.evaluate((clientId) => ZeroHubUnitHarness.recordZeroHubErrors(clientId), id);
  await page.evaluate((clientId) => ZeroHubUnitHarness.createHub(clientId, "room"), id);

  // Operator migrates `a` to the new instance `new.example` (not configured):
  // the live socket closes 1001 with the backup host in the reason.
  await page.evaluate(
    (clientId) => ZeroHubUnitHarness.simulateMigrationClose(clientId, "new.example"),
    id
  );
  expect(await page.evaluate((clientId) => ZeroHubUnitHarness.getHost(clientId), id)).toBe(
    "new.example"
  );
  // The redirect target is not in the list: hostIndex stays put (0) — it
  // does NOT point at the redirected host.
  expect(await page.evaluate((clientId) => ZeroHubUnitHarness.getHostIndex(clientId), id)).toBe(0);
  expect(await page.evaluate((clientId) => ZeroHubUnitHarness.getLastSocketUrl(clientId), id)).toBe(
    "wss://new.example/v1/hubs/create?id=room"
  );

  // The redirected host flaps once (a transient 1006, like the blip that
  // triggered the original migration): the client must retry the SAME
  // (redirected) host — not advance the stale hostIndex onto old host `a`,
  // and certainly not hit the self-redirect terminal error.
  await page.evaluate(
    (clientId) => ZeroHubUnitHarness.simulateAbnormalClose(clientId),
    id
  );
  await page.waitForTimeout(400); // attempt-#1 backoff (250 ms base ±20%)

  // The retry re-dialed the redirected host…
  expect(await page.evaluate((clientId) => ZeroHubUnitHarness.getHost(clientId), id)).toBe(
    "new.example"
  );
  expect(await page.evaluate((clientId) => ZeroHubUnitHarness.getLastSocketUrl(clientId), id)).toBe(
    "wss://new.example/v1/hubs/create?id=room"
  );
  expect(await page.evaluate((clientId) => ZeroHubUnitHarness.getZeroHubErrors(clientId), id)).toHaveLength(
    0
  );

  // …and the server's hub info confirms the recovered session.
  await page.evaluate(
    (clientId) => ZeroHubUnitHarness.sendHubInfoOnSocket(clientId, "room", "1"),
    id
  );
  expect(await page.evaluate((clientId) => ZeroHubUnitHarness.getHost(clientId), id)).toBe(
    "new.example"
  );
  expect(await page.evaluate((clientId) => ZeroHubUnitHarness.getZeroHubErrors(clientId), id)).toHaveLength(
    0
  );
});

test("migration redirect to the current host (self-redirect) does not reconnect", async ({
  page,
}) => {
  await prepareUnitHarnessPage(page);

  // Single configured host: the operator points /admin/migrate at the
  // current host (typo, or the old server still draining), so every
  // connection is closed with 1001 + reason = our own host.
  const id = await page.evaluate(
    () => ZeroHubUnitHarness.createClientWithHosts(["a.zerohub.dev"])
  );
  await page.evaluate((clientId) => ZeroHubUnitHarness.recordZeroHubErrors(clientId), id);
  await page.evaluate((clientId) => ZeroHubUnitHarness.createHub(clientId, "room"), id);
  const originalUrl = await page.evaluate(
    (clientId) => ZeroHubUnitHarness.getLastSocketUrl(clientId),
    id
  );
  expect(originalUrl).toBe("wss://a.zerohub.dev/v1/hubs/create?id=room");

  // Self-redirect: the close reason is the host we are already on.
  await page.evaluate(
    (clientId) => ZeroHubUnitHarness.simulateMigrationClose(clientId, "a.zerohub.dev"),
    id
  );

  // The guard must stop the loop: no second socket is opened, host state
  // stays put, and the terminal failure is surfaced to the application.
  expect(await page.evaluate((clientId) => ZeroHubUnitHarness.getLastSocketUrl(clientId), id)).toBe(
    originalUrl
  );
  expect(await page.evaluate((clientId) => ZeroHubUnitHarness.getHost(clientId), id)).toBe(
    "a.zerohub.dev"
  );
  const errors = await page.evaluate(
    (clientId) => ZeroHubUnitHarness.getZeroHubErrors(clientId),
    id
  );
  expect(errors).toHaveLength(1);
  expect(errors[0]).toContain("redirect target `a.zerohub.dev` is the current host, not retrying");
});

test("1001 close with a non-host reason does not corrupt host state and fails over", async ({
  page,
}) => {
  await prepareUnitHarnessPage(page);

  // An intermediate hop (reverse proxy, load balancer) closes the socket
  // with code 1001 and a human-readable reason instead of the ZeroHub
  // server's migration redirect. The reason must NOT be trusted as a host.
  const id = await page.evaluate(
    () => ZeroHubUnitHarness.createClientWithHosts(["a.zerohub.dev", "b.zerohub.dev"])
  );
  await page.evaluate((clientId) => ZeroHubUnitHarness.createHub(clientId, "room"), id);
  const originalUrl = await page.evaluate(
    (clientId) => ZeroHubUnitHarness.getLastSocketUrl(clientId),
    id
  );
  expect(originalUrl).toBe("wss://a.zerohub.dev/v1/hubs/create?id=room");

  await page.evaluate(
    (clientId) =>
      ZeroHubUnitHarness.simulateMigrationClose(
        clientId,
        "Server going away for maintenance"
      ),
    id
  );

  // Host state moved by the automatic failover path, not the redirect path:
  // it dialed the next configured host `b` (hostIndex advanced), and it is
  // never the garbage reason string.
  expect(await page.evaluate((clientId) => ZeroHubUnitHarness.getHost(clientId), id)).toBe(
    "b.zerohub.dev"
  );
  expect(await page.evaluate((clientId) => ZeroHubUnitHarness.getHostIndex(clientId), id)).toBe(
    1
  );

  // The client dialed the next configured host, not the garbage reason: no
  // socket exists against "Server going away for maintenance".
  expect(await page.evaluate((clientId) => ZeroHubUnitHarness.getLastSocketUrl(clientId), id)).toBe(
    "wss://b.zerohub.dev/v1/hubs/create?id=room"
  );
});

test("1001 close with a non-host reason on the last host retries the same host instead of wedging", async ({
  page,
}) => {
  await prepareUnitHarnessPage(page);

  // Single configured host: a 1001 close with a non-host reason falls back to
  // the automatic-failover path, which has no backup host to move to. The
  // client must NOT throw out of the close handler or leave the client
  // wedged with corrupted host state — it retries the SAME host with
  // backoff and, once that retry budget is spent, surfaces the terminal
  // error via `onZeroHubError` (the pre-fix behavior rejected immediately on
  // the first 1001: the single-host give-up bug this task fixes).
  const id = await page.evaluate(
    () => ZeroHubUnitHarness.createClientWithHosts(["a.zerohub.dev"])
  );
  await page.evaluate((clientId) => ZeroHubUnitHarness.recordZeroHubErrors(clientId), id);
  await page.evaluate((clientId) => ZeroHubUnitHarness.createHub(clientId, "room"), id);
  // Confirm the session (the server's hub info) so an abnormal close takes
  // the RECONNECT path (same-host retry with backoff) instead of the
  // initial-connection failover, which on a single host would be a terminal
  // error on the first close.
  await page.evaluate((clientId) => ZeroHubUnitHarness.sendHubInfoOnSocket(clientId, "room", "1"), id);
  // Shrink the retry budget so the terminal error is reachable in-test.
  await page.evaluate(
    (clientId) =>
      ZeroHubUnitHarness.setConfig(clientId, { maxReconnectAttempts: 2 }),
    id
  );
  const originalUrl = await page.evaluate(
    (clientId) => ZeroHubUnitHarness.getLastSocketUrl(clientId),
    id
  );
  expect(originalUrl).toBe("wss://a.zerohub.dev/v1/hubs/create?id=room");

  // `simulateMigrationClose` would reject with a stack trace if the close
  // handler threw; reaching this point means `onclose` completed cleanly.
  await page.evaluate(
    (clientId) =>
      ZeroHubUnitHarness.simulateMigrationClose(clientId, "Maintenance in progress"),
    id
  );

  // The first 1001 must NOT surface a terminal error: the same-host retry
  // dials the original URL after the backoff delay.
  await page.waitForTimeout(400);
  expect(await page.evaluate((clientId) => ZeroHubUnitHarness.getSocketCount(clientId), id)).toBe(
    2
  );
  // No socket was opened toward the reason string; host state is intact and
  // the retry re-dialed the SAME host.
  expect(await page.evaluate((clientId) => ZeroHubUnitHarness.getLastSocketUrl(clientId), id)).toBe(
    originalUrl
  );
  expect(await page.evaluate((clientId) => ZeroHubUnitHarness.getHost(clientId), id)).toBe(
    "a.zerohub.dev"
  );
  expect(await page.evaluate((clientId) => ZeroHubUnitHarness.getHostIndex(clientId), id)).toBe(
    0
  );
  expect(await page.evaluate((clientId) => ZeroHubUnitHarness.getZeroHubErrors(clientId), id)).toHaveLength(
    0
  );

  // Blip #2: the second retry dials again (still within the budget of 2).
  await page.evaluate(
    (clientId) =>
      ZeroHubUnitHarness.simulateMigrationClose(clientId, "Maintenance in progress"),
    id
  );
  await page.waitForTimeout(700);
  expect(await page.evaluate((clientId) => ZeroHubUnitHarness.getSocketCount(clientId), id)).toBe(
    3
  );
  expect(await page.evaluate((clientId) => ZeroHubUnitHarness.getZeroHubErrors(clientId), id)).toHaveLength(
    0
  );

  // Blip #3: the retry budget is genuinely spent — the terminal failure
  // (all hosts exhausted) is surfaced to the application instead of the
  // client staying wedged.
  await page.evaluate(
    (clientId) =>
      ZeroHubUnitHarness.simulateMigrationClose(clientId, "Maintenance in progress"),
    id
  );
  // The failover rejection settles in microtasks; flush them.
  await page.evaluate(async () => {
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
  const errors = await page.evaluate(
    (clientId) => ZeroHubUnitHarness.getZeroHubErrors(clientId),
    id
  );
  expect(errors).toHaveLength(1);
  expect(errors[0]).toContain("all ZeroHub hosts are not working");
});

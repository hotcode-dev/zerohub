import { test, expect } from "@playwright/test";
import { v4 as uuidv4 } from "uuid";
import {
  getCreateHubTestId,
  getCreatePeerStatusTestId,
  getJoinHubTestId,
  getJoinPeerStatusTestId,
  prepareHarnessPage,
} from "./utils/harness";

type ClientInfo = {
  host: string;
  hostIndex: number;
  wsOpen: boolean;
};

async function getClientInfo(
  page: import("@playwright/test").Page,
  componentId: string
) {
  return page.evaluate(
    ({ id }) => window.ZeroHubHarness.getClientInfo(id) as ClientInfo,
    { id: componentId }
  );
}

test("multi hosts", async ({ page }, testInfo) => {
  // Each client's first host (`127.0.0.1:9` — nothing listens on the discard
  // port) fails with a connection refusal, and three clients are created in
  // sequence — the default 10s timeout is not enough.
  testInfo.setTimeout(60 * 1000);
  await prepareHarnessPage(page);
  let hubId: string = "";
  const componentId = uuidv4();
  // Nothing listens on 127.0.0.1:9 (the discard port — connection refused ->
  // code 1006), so it is an unreachable first host in every environment.
  // Do NOT use a name like `this_is_bad_host` here: it may be pinned to a
  // reachable loopback IP (e.g. 127.0.0.2) in local `/etc/hosts`, which
  // makes the "bad" host actually work.
  const zeroHubBadHost = "127.0.0.1:9";
  const zeroHubGoodHost = "localhost:8080";
  const zeroHubSecondGoodHost = "localhost:8081";

  await page.evaluate(
    ({
      componentId: id,
      zeroHubBadHost: badHost,
      zeroHubGoodHost: goodHost,
      zeroHubSecondGoodHost: secondGoodHost,
    }) => {
      window.ZeroHubHarness.createHub({
        testName: "multi hosts, create hub",
        zeroHubHosts: [badHost, goodHost, secondGoodHost],
        componentId: id,
      });
    },
    {
      componentId,
      zeroHubBadHost,
      zeroHubGoodHost,
      zeroHubSecondGoodHost,
    }
  );

  await test.step("create hub success", async () => {
    const hubIdLoc = page.getByTestId(getCreateHubTestId(componentId)).first();
    await expect(hubIdLoc).toHaveText(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    hubId = (await hubIdLoc.textContent()) || "";
  });

  await test.step("single connection failure advances hostIndex exactly once", async () => {
    // Regression guard for the double-reconnect bug: a network failure fires
    // both `error` and `close` (code 1006). Only `onclose` may call
    // `reconnect()`; if `onerror` also does, `hostIndex` advances twice for a
    // single failure (skipping two hosts) and the first reconnection's
    // WebSocket is orphaned. By the time the hub id has arrived, failover is
    // complete, so exactly one host must have been skipped. Three hosts are
    // required: with two hosts the buggy second `reconnect()` is an
    // out-of-range no-op that clamps `hostIndex` to 1 and hides the bug.
    //
    // `hostIndex` (unlike a raw reconnect-call count) is also stable when the
    // server is in migrate mode: the 1001 "going away -> <host>" redirect
    // takes the `newHost` path, which reconnects without touching `hostIndex`.
    const info = await getClientInfo(page, componentId);
    expect(info.hostIndex).toBe(1);
    expect(info.wsOpen).toBe(true);
  });

  await page.evaluate(
    ({
      componentId: id,
      zeroHubBadHost: badHost,
      zeroHubGoodHost: goodHost,
      zeroHubSecondGoodHost: secondGoodHost,
      hubId: joinHubId,
    }) => {
      window.ZeroHubHarness.joinHub({
        testName: "multi hosts, join hub",
        hubId: joinHubId,
        zeroHubHosts: [badHost, goodHost, secondGoodHost],
        componentId: id,
      });
    },
    {
      componentId,
      zeroHubBadHost,
      zeroHubGoodHost,
      zeroHubSecondGoodHost,
      hubId,
    }
  );
  await test.step("join hub success", async () => {
    await expect(
      page.getByTestId(getJoinHubTestId(componentId)).first()
    ).toHaveText(hubId);
  });

  await test.step(
    "joiner single connection failure advances hostIndex exactly once",
    async () => {
      // The joiner is a fresh client registered under the same componentId,
      // so it must also have skipped exactly one host on its single failure.
      const info = await getClientInfo(page, componentId);
      expect(info.hostIndex).toBe(1);
      expect(info.wsOpen).toBe(true);
    }
  );

  await test.step("peer status connected", async () => {
    await expect(
      page.getByTestId(getCreatePeerStatusTestId(componentId)).first()
    ).toContainText("connected");
    await expect(
      page.getByTestId(getJoinPeerStatusTestId(componentId)).first()
    ).toContainText("connected");
  });

  await test.step(
    "abnormal close on the last host retries the SAME host and recovers without a terminal error",
    async () => {
      // A fresh client whose FIRST host is unreachable: the initial
      // connection fails and failover advances to the good last host, where
      // hub creation succeeds. The client is now on its LAST configured
      // host, so an abnormal close there used to reject immediately (no
      // backup host left to fail over to) and abandon reconnection forever —
      // the single-host give-up bug. After the fix, `reconnect()` retries the
      // SAME last host with exponential backoff instead: the server is
      // healthy, the retry re-dials it, and the session recovers without the
      // application intervening. The terminal "all hosts exhausted"
      // `onZeroHubError` is reachable only when the last host is genuinely
      // dead — which cannot be driven against this live server, so that path
      // is asserted in `unit-reconnect-error.spec.ts` /
      // `unit-reconnect-retry.spec.ts` against a mock socket.
      const terminalComponentId = uuidv4();
      await page.evaluate(
        ({ componentId: id, badHost, goodHost }) => {
          window.ZeroHubHarness.createHub({
            testName: "multi hosts, last host blip",
            zeroHubHosts: [badHost, goodHost],
            componentId: id,
          });
        },
        {
          componentId: terminalComponentId,
          badHost: zeroHubBadHost,
          goodHost: zeroHubGoodHost,
        }
      );

      await test.step("initial connection succeeds after one host skip", async () => {
        const hubIdLoc = page
          .getByTestId(getCreateHubTestId(terminalComponentId))
          .first();
        // The first host (`127.0.0.1:9`) is unreachable, so the initial
        // connection must fail (connection refusal -> code 1006) before
        // failover advances to the good host. Give this assertion a
        // generous expect-timeout.
        await expect(hubIdLoc).toHaveText(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
          { timeout: 30_000 }
        );
        const info = await getClientInfo(page, terminalComponentId);
        expect(info.hostIndex).toBe(1);
      });

      // Spy on `onZeroHubError` while the connection is still healthy, so the
      // only error that would matter for the assertion is a premature
      // terminal one (the pre-fix give-up on the first blip).
      await page.evaluate(({ componentId: id }) => {
        window.ZeroHubHarness.captureZeroHubErrors(id);
      }, { componentId: terminalComponentId });

      // Simulate a transient abnormal connection drop (code 1006) while the
      // server is healthy: the client is on its last host, so the same-host
      // retry must re-dial it and recover the signaling connection.
      await page.evaluate(({ componentId: id }) => {
        window.ZeroHubHarness.triggerAbnormalClose(id);
      }, { componentId: terminalComponentId });

      await test.step("the same-host retry re-dials the good host and the socket recovers", async () => {
        await expect
          .poll(
            async () => (await getClientInfo(page, terminalComponentId))
              .wsOpen,
            { timeout: 10_000 }
          )
          .toBe(true);
        // hostIndex is untouched by same-host retries: failover already
        // advanced exactly once during the initial dial.
        const info = await getClientInfo(page, terminalComponentId);
        expect(info.hostIndex).toBe(1);
      });

      await test.step("no terminal onZeroHubError fired for the transient blip", async () => {
        // Give any (incorrect) terminal rejection a chance to settle.
        await new Promise((resolve) => setTimeout(resolve, 500));
        const messages = await page.evaluate(
          ({ componentId: id }) =>
            window.ZeroHubHarness.getZeroHubErrorMessages(id),
          { componentId: terminalComponentId }
        );
        expect(messages).toHaveLength(0);
      });
    }
  );
});

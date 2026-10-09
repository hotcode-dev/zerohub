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
  // Each client's first host (`this_is_bad_host`) fails with a DNS
  // resolution error that takes several seconds, and three clients are
  // created in sequence — the default 10s timeout is not enough.
  testInfo.setTimeout(60 * 1000);
  await prepareHarnessPage(page);
  let hubId: string = "";
  const componentId = uuidv4();
  const zeroHubBadHost = "this_is_bad_host:8080";
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
    "terminal all-hosts-exhausted failure surfaces via onZeroHubError",
    async () => {
      // A fresh client whose FIRST host is unreachable: the initial
      // connection fails and failover advances to the good last host, where
      // hub creation succeeds. `reconnect()` now has no backup host left, so
      // `getZeroHubBackupHost()` rejects and that terminal, unrecoverable
      // failure must reach the public `onZeroHubError` callback
      // (previously it was only logged and silently swallowed).
      const terminalComponentId = uuidv4();
      await page.evaluate(
        ({ componentId: id, badHost, goodHost }) => {
          window.ZeroHubHarness.createHub({
            testName: "multi hosts, all hosts exhausted",
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
        // The first host (`this_is_bad_host`) is unreachable, so the initial
        // connection must fail (network error -> code 1006) before failover
        // advances to the good host. DNS resolution failure can take several
        // seconds, so give this assertion a generous expect-timeout.
        await expect(hubIdLoc, { timeout: 30_000 }).toHaveText(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
        );
        const info = await getClientInfo(page, terminalComponentId);
        expect(info.hostIndex).toBe(1);
      });

      // Spy on `onZeroHubError` while the connection is still healthy, so
      // the only error that matters for the assertion is the terminal one.
      await page.evaluate(({ componentId: id }) => {
        window.ZeroHubHarness.captureZeroHubErrors(id);
      }, { componentId: terminalComponentId });

      // Simulate an abnormal connection drop (code 1006), which triggers
      // `reconnect()`: the client is already on its last host, so the
      // terminal rejection must surface through `onZeroHubError`.
      await page.evaluate(({ componentId: id }) => {
        window.ZeroHubHarness.triggerAbnormalClose(id);
      }, { componentId: terminalComponentId });

      await expect
        .poll(
          async () => {
            const messages = await page.evaluate(
              ({ componentId: id }) =>
                window.ZeroHubHarness.getZeroHubErrorMessages(id),
              { componentId: terminalComponentId }
            );
            return messages.length > 0 ? messages[messages.length - 1] : null;
          },
          { timeout: 10_000 }
        )
        .toBe(
          "all ZeroHub hosts are not working, please check the ZeroHub hosts"
        );
    }
  );
});

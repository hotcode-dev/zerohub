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

test("multi hosts", async ({ page }) => {
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
});

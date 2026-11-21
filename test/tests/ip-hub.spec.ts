import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  getJoinIPHubTestId,
  getJoinIPPeerStatusTestId,
  getJoinOrCreateIPHubTestId,
  getJoinOrCreateIPPeerStatusTestId,
  prepareHarnessPage,
} from "./utils/harness";

/**
 * Exercises the IP hub workflow used by share.zerohub.dev:
 *  1. Tab 1 opens `/v1/ip-hubs/join-or-create` via `joinOrCreateIPHub()` and
 *     receives the server-generated IP hub ID in `onHubInfo`.
 *  2. Tab 2 copies the invite link (`?id=<hubId>`) and joins that IP hub by ID
 *     via `joinIPHub(hubId)` (`/v1/ip-hubs/join?id=<hubId>`).
 *  3. Both peers exchange SDP offer/answer and reach the `connected` WebRTC
 *     state.
 */
test("ip hub join-or-create + join by id connects", async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(60 * 1000);
  const zeroHubHost = "localhost:8081";
  const creatorId = randomUUID();
  const joinerId = randomUUID();

  await prepareHarnessPage(page);

  await test.step("creator calls joinOrCreateIPHub", async () => {
    await page.evaluate(
      ({ id, host }) => {
        window.ZeroHubHarness.joinOrCreateIPHub({
          testName: "ip hub creator",
          zeroHubHosts: [host],
          componentId: id,
        });
      },
      { id: creatorId, host: zeroHubHost }
    );
  });

  let ipHubId = "";
  await test.step("creator receives non-empty IP hub id", async () => {
    const creatorHubLoc = page
      .getByTestId(getJoinOrCreateIPHubTestId(creatorId))
      .first();
    await expect(creatorHubLoc).toHaveText(/^\d+$/);
    ipHubId = (await creatorHubLoc.textContent()) ?? "";
    expect(ipHubId.length).toBeGreaterThan(0);
  });

  await test.step("joiner joins the IP hub by id via joinIPHub", async () => {
    await page.evaluate(
      ({ id, host, hubId }) => {
        window.ZeroHubHarness.joinIPHub({
          testName: "ip hub joiner by id",
          zeroHubHosts: [host],
          hubId,
          componentId: id,
        });
      },
      { id: joinerId, host: zeroHubHost, hubId: ipHubId }
    );

    await expect(
      page.getByTestId(getJoinIPHubTestId(joinerId)).first()
    ).toHaveText(ipHubId);
  });

  await test.step("both peers reach connected WebRTC status", async () => {
    await expect(
      page.getByTestId(getJoinOrCreateIPPeerStatusTestId(creatorId)).first()
    ).toHaveText("connected", { timeout: 30 * 1000 });

    await expect(
      page.getByTestId(getJoinIPPeerStatusTestId(joinerId)).first()
    ).toHaveText("connected", { timeout: 30 * 1000 });
  });
});

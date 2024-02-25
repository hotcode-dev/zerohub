import { test, expect } from "@playwright/experimental-ct-svelte";
import CreateHub from "./CreateHub.svelte";
import JoinHub from "./JoinHub.svelte";
import { HUB_ID } from "./const";

test.use({ viewport: { width: 500, height: 500 } });

test("create/join hub", async ({ mount }) => {
  const createHub = await mount(CreateHub);

  await test.step("create hub success", async () => {
    await expect(createHub).toContainText(`HubID:${HUB_ID}`);
  });

  const joinHub = await mount(JoinHub);

  await test.step("join hub success", async () => {
    await expect(joinHub).toContainText(`HubID:${HUB_ID}`);
  });

  await test.step("peer status connected", async () => {
    await expect(createHub).toContainText("PeerStatus:connected");
    await expect(joinHub).toContainText("PeerStatus:connected");
  });
});

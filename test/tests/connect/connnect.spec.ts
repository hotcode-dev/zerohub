import { test, expect } from "@playwright/experimental-ct-svelte";
import type { ComponentProps } from "svelte";
import CreateHub from "./CreateHub.svelte";
import JoinHub from "./JoinHub.svelte";

test.use({ viewport: { width: 500, height: 500 } });

test("create/join hub", async ({ mount }) => {
  const hubId = "connect-hub-id";
  const zeroHubURL = "ws://localhost:8080";

  const props: ComponentProps<CreateHub> = {
    hubId: hubId,
    zeroHubURL: zeroHubURL,
  };

  const createHub = await mount(CreateHub, {
    props: props,
  });

  await test.step("create hub success", async () => {
    await expect(createHub).toContainText(`HubID:${hubId}`);
  });

  const joinHub = await mount(JoinHub, {
    props: props,
  });

  await test.step("join hub success", async () => {
    await expect(joinHub).toContainText(`HubID:${hubId}`);
  });

  await test.step("peer status connected", async () => {
    await expect(createHub).toContainText("PeerStatus:connected");
    await expect(joinHub).toContainText("PeerStatus:connected");
  });
});

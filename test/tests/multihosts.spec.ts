import { test, expect } from "@playwright/experimental-ct-svelte";
import type { ComponentProps } from "svelte";
import CreateHub from "./components/CreateHub.svelte";
import JoinHub from "./components/JoinHub.svelte";
import { v4 as uuidv4 } from "uuid";

test.use({ viewport: { width: 500, height: 500 } });

test("multi hosts", async ({ mount }) => {
  const hubId = uuidv4();
  const zeroHubBadHost = "this_is_bad_host:8080";
  const zeroHubGoodHost = "localhost:8080";

  const props: ComponentProps<CreateHub> = {
    hubId: hubId,
    zeroHubHosts: [zeroHubBadHost, zeroHubGoodHost],
  };

  const createHub = await mount(CreateHub, {
    props: props,
  });
  await test.step("create hub success", async () => {
    await expect(createHub).toContainText(`HubId:${hubId}`);
  });

  const joinHub = await mount(JoinHub, {
    props: props,
  });
  await test.step("join hub success", async () => {
    await expect(joinHub).toContainText(`HubId:${hubId}`);
  });

  await test.step("peer status connected", async () => {
    await expect(createHub).toContainText("PeerStatus:connected");
    await expect(joinHub).toContainText("PeerStatus:connected");
  });
});

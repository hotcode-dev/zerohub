import { test, expect } from "@playwright/experimental-ct-svelte";
import CreateHub from "./components/CreateHub.svelte";
import JoinHub from "./components/JoinHub.svelte";
import { v4 as uuidv4 } from "uuid";

test.use({ viewport: { width: 500, height: 500 } });

test("create/join hub", async ({ mount }) => {
  const componentId = uuidv4();
  const zeroHubHost = "localhost:8080";
  let hubId: string = "";

  const createHub = await mount(CreateHub, {
    props: {
      zeroHubHosts: [zeroHubHost],
      componentId: componentId,
    },
  });

  await test.step("create hub success", async () => {
    const hubIdLoc = createHub
      .getByTestId(`create-hub-id-${componentId}`)
      .first();
    await expect(hubIdLoc).toHaveText(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    hubId = (await hubIdLoc.textContent()) || "";
  });

  const joinHub = await mount(JoinHub, {
    props: {
      zeroHubHosts: [zeroHubHost],
      hubId: hubId,
      componentId: componentId,
    },
  });

  await test.step("join hub success", async () => {
    await expect(
      joinHub.getByTestId(`join-hub-id-${componentId}`).first()
    ).toHaveText(hubId);
  });

  await test.step("peer status connected", async () => {
    await expect(
      createHub.getByTestId(`create-peer-status-${componentId}`).first()
    ).toHaveText("connected");

    await expect(
      joinHub.getByTestId(`join-peer-status-${componentId}`).first()
    ).toHaveText("connected");
  });
});

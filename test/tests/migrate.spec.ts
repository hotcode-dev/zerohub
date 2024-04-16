import { test, expect } from "@playwright/experimental-ct-svelte";
import type { ComponentProps } from "svelte";
import CreateHub from "./components/CreateHub.svelte";
import JoinHub from "./components/JoinHub.svelte";
import { v4 as uuidv4 } from "uuid";

test.use({ viewport: { width: 500, height: 500 } });

test("migrate", async ({ mount }) => {
  const hubId = uuidv4();
  const hubIdNew = uuidv4();
  const zeroHubHost = "localhost:8080";
  const zeroHubHostNew = "localhost:8081";
  const migrateURL = "http://localhost:8080/admin/migrate";
  const clientSecret = "client_secret";

  const props: ComponentProps<CreateHub> = {
    hubId: hubId,
    zeroHubHosts: [zeroHubHost],
  };

  const createHub = await mount(CreateHub, {
    props: props,
  });
  await test.step("create hub success", async () => {
    await expect(createHub).toContainText(`HubId:${hubId}`);
  });

  // Make a request to migrate to the new zerohub host
  const res = await fetch(`${migrateURL}?host=${zeroHubHostNew}`, {
    headers: {
      Authorization: Buffer.from(clientSecret).toString("base64"),
    },
  });
  await test.step("migrate success", async () => {
    expect(res.status).toBe(200);
  });

  // test join the first hub after migrate
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

  const props2: ComponentProps<CreateHub> = {
    hubId: hubIdNew,
    zeroHubHosts: [zeroHubHostNew],
  };
  const createHub2 = await mount(CreateHub, {
    props: props2,
  });
  await test.step("create hub success", async () => {
    await expect(createHub2).toContainText(`HubId:${hubIdNew}`);
  });

  const joinHub2 = await mount(JoinHub, {
    props: props2,
  });
  await test.step("join hub success", async () => {
    await expect(joinHub2).toContainText(`HubId:${hubIdNew}`);
  });

  await test.step("peer status connected", async () => {
    await expect(createHub2).toContainText("PeerStatus:connected");
    await expect(joinHub2).toContainText("PeerStatus:connected");
  });
});

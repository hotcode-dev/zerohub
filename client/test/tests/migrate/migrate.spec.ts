import { test, expect } from "@playwright/experimental-ct-svelte";
import type { ComponentProps } from "svelte";
import CreateHub from "./CreateHub.svelte";
import JoinHub from "./JoinHub.svelte";

test.use({ viewport: { width: 500, height: 500 } });

test("migrate", async ({ mount }) => {
  const hubId = "migrate-hub-id";
  const hubIdNew = "migrate-hub-id-2";
  const zeroHubHost = "localhost:8080";
  const zeroHubHostNew = "localhost:8081";
  const migrateURL = "http://localhost:8080/admin/migrate";
  const clientSecret = "client_secret";

  const props: ComponentProps<CreateHub> = {
    hubId: hubId,
    zeroHubHost: zeroHubHost,
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

  // Migrate
  const res = await fetch(`${migrateURL}?host=${zeroHubHostNew}`, {
    headers: {
      Authorization: Buffer.from(clientSecret).toString("base64"),
    },
  });
  await test.step("migrate success", async () => {
    expect(res.status).toBe(200);
  });

  const props2: ComponentProps<CreateHub> = {
    hubId: hubIdNew,
    zeroHubHost: zeroHubHostNew,
  };
  const createHub2 = await mount(CreateHub, {
    props: props2,
  });
  await test.step("create hub success", async () => {
    await expect(createHub2).toContainText(`HubID:${hubIdNew}`);
  });

  const joinHub2 = await mount(JoinHub, {
    props: props2,
  });
  await test.step("join hub success", async () => {
    await expect(joinHub2).toContainText(`HubID:${hubIdNew}`);
  });

  await test.step("peer status connected", async () => {
    await expect(createHub2).toContainText("PeerStatus:connected");
    await expect(joinHub2).toContainText("PeerStatus:connected");
  });
});

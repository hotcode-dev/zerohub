import { test, expect } from "@playwright/experimental-ct-svelte";
import CreateHub from "./components/CreateHub.svelte";
import JoinHub from "./components/JoinHub.svelte";
import { v4 as uuidv4 } from "uuid";

test.use({ viewport: { width: 500, height: 500 } });

test("migrate", async ({ mount }) => {
  let hubId: string = "";
  let hubIdNew: string = "";
  const componentId = uuidv4();
  const componentIdNew = uuidv4();
  const zeroHubHost = "localhost:8080";
  const zeroHubHostNew = "localhost:8081";
  const migrateURL = "http://localhost:8080/admin/migrate";
  const clientSecret = "client_secret";

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
    props: {
      hubId: hubId,
      zeroHubHosts: [zeroHubHost],
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

  const createHub2 = await mount(CreateHub, {
    props: {
      zeroHubHosts: [zeroHubHostNew],
      componentId: componentIdNew,
    },
  });
  await test.step("create hub success", async () => {
    const hubIdLoc = createHub2
      .getByTestId(`create-hub-id-${componentIdNew}`)
      .first();
    await expect(hubIdLoc).toHaveText(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    hubIdNew = (await hubIdLoc.textContent()) || "";
  });

  const joinHub2 = await mount(JoinHub, {
    props: {
      hubId: hubIdNew,
      zeroHubHosts: [zeroHubHostNew],
      componentId: componentIdNew,
    },
  });
  await test.step("join hub success", async () => {
    await expect(
      joinHub2.getByTestId(`join-hub-id-${componentIdNew}`).first()
    ).toHaveText(hubIdNew);
  });

  await test.step("peer status connected", async () => {
    await expect(
      createHub2.getByTestId(`create-peer-status-${componentIdNew}`).first()
    ).toHaveText("connected");
    await expect(
      joinHub2.getByTestId(`join-peer-status-${componentIdNew}`).first()
    ).toHaveText("connected");
  });
});

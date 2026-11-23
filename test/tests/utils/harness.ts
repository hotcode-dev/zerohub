import { Page, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { gotoStubPage } from "./stub-page";
import { TESTIDS } from "../../shared/testids";

const harnessPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../dist/harness.js"
);

export async function prepareHarnessPage(page: Page) {
  await page.addInitScript({ path: harnessPath });
  await gotoStubPage(page);
}

/**
 * Seeds a static hub out-of-band via the admin HTTP endpoint
 * `GET /v1/static-hubs/create` (requires the `Authorization` header).
 *
 * This runs NODE-side (not in the page): the browser WebSocket API cannot
 * carry custom headers, so the SDK exposes no static-hub create, and a
 * cross-origin browser `fetch` with an `Authorization` header would trip
 * the CORS preflight. The Node-side `fetch` (Playwright's Node runtime)
 * reaches the local admin endpoint directly.
 *
 * `make server-serve` / `server-serve-2` both set APP_CLIENT_SECRET=client_secret.
 * Static hubs never expire (isPermanent=true), so a seeded hub stays
 * joinable for the whole test. Returns the created hub id.
 */
export async function seedStaticHub(hubId: string, host: string): Promise<string> {
  const adminAuth = Buffer.from("client_secret").toString("base64");
  const res = await fetch(
    `http://${host}/v1/static-hubs/create?id=${encodeURIComponent(hubId)}`,
    { headers: { Authorization: adminAuth } }
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { id: string; isPermanent: boolean };
  expect(body.id).toBe(hubId);
  expect(body.isPermanent).toBe(true);
  return body.id;
}

export function getCreateHubTestId(componentId: string) {
  return TESTIDS.createHubId(componentId);
}

export function getCreatePeerStatusTestId(componentId: string) {
  return TESTIDS.createPeerStatus(componentId);
}

export function getJoinHubTestId(componentId: string) {
  return TESTIDS.joinHubId(componentId);
}

export function getJoinPeerStatusTestId(componentId: string) {
  return TESTIDS.joinPeerStatus(componentId);
}

export function getJoinStaticHubTestId(componentId: string) {
  return TESTIDS.joinStaticHubId(componentId);
}

export function getJoinStaticPeerStatusTestId(componentId: string) {
  return TESTIDS.joinStaticPeerStatus(componentId);
}

export function getJoinOrCreateIPHubTestId(componentId: string) {
  return TESTIDS.joinOrCreateIPHubId(componentId);
}

export function getJoinOrCreateIPPeerStatusTestId(componentId: string) {
  return TESTIDS.joinOrCreateIPPeerStatus(componentId);
}

export function getJoinIPHubTestId(componentId: string) {
  return TESTIDS.joinIPHubId(componentId);
}

export function getJoinIPPeerStatusTestId(componentId: string) {
  return TESTIDS.joinIPPeerStatus(componentId);
}

export function getDisconnectStatusTestId(componentId: string) {
  return TESTIDS.disconnectStatus(componentId);
}

export function getReuseHubTestId(componentId: string) {
  return TESTIDS.reuseHubId(componentId);
}

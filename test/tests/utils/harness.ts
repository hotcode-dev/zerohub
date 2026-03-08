import { Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const harnessPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../dist/harness.js"
);

export async function prepareHarnessPage(page: Page) {
  await page.addInitScript({ path: harnessPath });
  const html = "<html><head></head><body></body></html>";
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  await page.goto(dataUrl);
}

export function getCreateHubTestId(componentId: string) {
  return `create-hub-id-${componentId}`;
}

export function getCreatePeerStatusTestId(componentId: string) {
  return `create-peer-status-${componentId}`;
}

export function getJoinHubTestId(componentId: string) {
  return `join-hub-id-${componentId}`;
}

export function getJoinPeerStatusTestId(componentId: string) {
  return `join-peer-status-${componentId}`;
}

/**
 * Single source of truth for E2E `data-testid` string templates.
 *
 * Both the browser-bundled harness (which sets the DOM attribute, see
 * `harness/index.ts`) and the Node-side Playwright utils (which build the
 * locator query, see `tests/utils/harness.ts`) derive these values from here.
 * Renaming a testid in one place now updates every consumer, so a rename can
 * no longer silently desync the DOM attribute from its locator.
 */
export const TESTIDS = {
  createHubId: (componentId: string) => `create-hub-id-${componentId}`,
  createPeerStatus: (componentId: string) => `create-peer-status-${componentId}`,
  joinHubId: (componentId: string) => `join-hub-id-${componentId}`,
  joinPeerStatus: (componentId: string) => `join-peer-status-${componentId}`,
  joinStaticHubId: (componentId: string) => `join-static-hub-id-${componentId}`,
  joinStaticPeerStatus: (componentId: string) => `join-static-peer-status-${componentId}`,
  joinOrCreateIPHubId: (componentId: string) => `join-or-create-ip-hub-id-${componentId}`,
  joinOrCreateIPPeerStatus: (componentId: string) => `join-or-create-ip-peer-status-${componentId}`,
  joinIPHubId: (componentId: string) => `join-ip-hub-id-${componentId}`,
  joinIPPeerStatus: (componentId: string) => `join-ip-peer-status-${componentId}`,
  disconnectStatus: (componentId: string) => `disconnect-status-${componentId}`,
  reuseHubId: (componentId: string) => `reuse-hub-id-${componentId}`,
};

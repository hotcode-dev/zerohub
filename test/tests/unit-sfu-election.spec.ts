import { test, expect, Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Unit tests for `SFUTopology` SFU election (client/src/topology/sfuTopology.ts).
 *
 * Regression: the topology elected the SFU by sorting peer IDs with a bare
 * `Array.prototype.sort()` — lexicographic order. Peer IDs are sequential
 * decimal strings ("1", "2", ..., "10", ...), so with peers 2..11 present
 * the lexicographic minimum is "10", and no peer agreed on who the SFU was
 * (peer "10" alone claimed `iAmSFU`). The fix compares `parseInt(a, 10)`
 * numerically, so the lowest *numeric* ID always wins.
 *
 * Driven through the unit harness (`window.ZeroHubUnitHarness.sfuElection`),
 * which builds a real client whose topology is a default `SFUTopology` and
 * reads the topology's private `getSFUPeerId()` / `isSFU()`. No server, no
 * real WebRTC stack.
 */

/** The in-page driver surface (window.ZeroHubUnitHarness). */
type Harness = {
  sfuElection(myPeerId: string, peerIds: string[]): {
    sfuPeerId: string | undefined;
    iAmSFU: boolean;
  };
};

declare global {
  // eslint-disable-next-line no-var
  var ZeroHubUnitHarness: Harness;
}

/** Inject the unit harness (mocked RTCPeerConnection + driver) into a page. */
async function prepareUnitHarnessPage(page: Page) {
  await page.addInitScript({ path: unitHarnessPath() });
  const html = "<html><head></head><body></body></html>";
  await page.goto(`data:text/html,${encodeURIComponent(html)}`);
}

function unitHarnessPath(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../dist/unit-harness.js",
  );
}

/**
 * What every peer in `peerIds` (viewed as `myPeerId`) independently elects,
 * from each peer's own perspective.
 */
async function electionsFromEveryPeer(
  page: Page,
  peerIds: string[],
): Promise<Record<string, { sfuPeerId: string | undefined; iAmSFU: boolean }>> {
  const out: Record<
    string,
    { sfuPeerId: string | undefined; iAmSFU: boolean }
  > = {};
  for (const myPeerId of peerIds) {
    out[myPeerId] = await page.evaluate(
      ([mine, others]) =>
        ZeroHubUnitHarness.sfuElection(mine, others),
      [myPeerId, peerIds] as const,
    );
  }
  return out;
}

test.describe("SFUTopology SFU election (numeric, not lexicographic)", () => {
  test("peer 1 leaving: all remaining peers agree the SFU is peer 2, not 10", async ({
    page,
  }) => {
    await prepareUnitHarnessPage(page);
    const remaining = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "11"];
    const elections = await electionsFromEveryPeer(page, remaining);

    await test.step("every remaining peer elects the numerically lowest ID", () => {
      for (const peerId of remaining) {
        expect(elections[peerId].sfuPeerId, `peer ${peerId} should elect 2`).toBe(
          "2",
        );
      }
    });

    await test.step("exactly one peer claims to be the SFU", () => {
      const claimants = remaining.filter((peerId) => elections[peerId].iAmSFU);
      expect(claimants).toEqual(["2"]);
    });

    await test.step("the lexicographic winner (peer 10) does NOT claim SFU", () => {
      expect(elections["10"].iAmSFU).toBe(false);
      expect(elections["10"].sfuPeerId).toBe("2");
    });
  });

  test("regression: with peers 1..9 present, the SFU is still peer 1", async ({
    page,
  }) => {
    await prepareUnitHarnessPage(page);
    const present = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
    const elections = await electionsFromEveryPeer(page, present);

    for (const peerId of present) {
      expect(elections[peerId].sfuPeerId, `peer ${peerId} should elect 1`).toBe(
        "1",
      );
    }
    expect(
      present.filter((peerId) => elections[peerId].iAmSFU),
    ).toEqual(["1"]);
  });

  test("full group 1..11: all peers agree the SFU is peer 1", async ({
    page,
  }) => {
    await prepareUnitHarnessPage(page);
    const present = [
      "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11",
    ];
    const elections = await electionsFromEveryPeer(page, present);

    for (const peerId of present) {
      expect(elections[peerId].sfuPeerId, `peer ${peerId} should elect 1`).toBe(
        "1",
      );
    }
    expect(
      present.filter((peerId) => elections[peerId].iAmSFU),
    ).toEqual(["1"]);
  });
});

import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";

/**
 * Locate the repository root (the directory containing `client/` and `docs/`)
 * by walking up from the process cwd. Resolved at runtime instead of
 * `__dirname` because this spec may be transpiled to ESM (the `test/` package
 * is `"type": "module"`), where `__dirname` is not available.
 */
function findRepoRoot(): string {
  // The Playwright runner starts in the `test/` package directory, so check
  // the cwd and its ancestors for the monorepo root.
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (
      existsSync(join(dir, "client", "src", "zeroHub.ts")) &&
      existsSync(
        join(
          dir,
          "docs",
          "src",
          "content",
          "docs",
          "api-reference",
          "sdk.md",
        ),
      )
    ) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `Could not locate the repository root starting from ${process.cwd()}`,
  );
}

const ROOT = findRepoRoot();

/**
 * Docs-consistency test: the SDK API-reference page
 * (`docs/src/content/docs/api-reference/sdk.md`) must document every public
 * event callback declared on `ZeroHubClient` (`client/src/zeroHub.ts`) in its
 * "## Events" section.
 *
 * Regression guard for the issue where `onOffer`, `onAnswer` and
 * `onPeerError` were missing from the Events section.
 *
 * Node-side only: no browser page and no live server are needed, so this spec
 * runs fast and is independent of the e2e harness.
 */

const DOCS_PATH = join(
  ROOT,
  "docs",
  "src",
  "content",
  "docs",
  "api-reference",
  "sdk.md",
);
const CLIENT_PATH = join(ROOT, "client", "src", "zeroHub.ts");

/** The public event callbacks the SDK currently exposes. */
const EXPECTED_CALLBACKS = [
  "onZeroHubError",
  "onHubInfo",
  "onPeerStatusChange",
  "onPeerError",
  "onOffer",
  "onAnswer",
];

/**
 * Extract the public event-callback property names declared on the
 * `ZeroHubClient` class. Only property declarations of the form
 * `public on<Name>?: (...) => void` are considered; this intentionally
 * excludes method declarations and non-`on*` fields.
 */
function discoverPublicCallbacks(clientSource: string): string[] {
  const re = /^\s*public\s+(on[A-Za-z0-9]+)\s*\?\s*:/gm;
  const names: string[] = [];
  for (let m = re.exec(clientSource); m; m = re.exec(clientSource)) {
    const name = m[1];
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * Extract the body of the "## Events" section (text up to the next `## `
 * heading or end of file).
 */
function extractEventsSection(docs: string): string {
  const match = /^##\s+Events\s+$/m.exec(docs);
  if (!match) return "";
  const start = match.index + match[0].length;
  const next = /^##\s+/m.exec(docs.slice(start));
  const end = next ? start + next.index : docs.length;
  return docs.slice(start, end);
}

/**
 * Return the set of callback names documented as bullet entries in the
 * section. A bullet is a line starting with `- ` whose first backticked
 * identifier (e.g. `onOffer(peer, offerSdp)`) is taken to be the callback,
 * normalized to the name before the parameter list.
 */
function documentedCallbacks(section: string): string[] {
  const names = new Set<string>();
  for (const [name] of bulletEntries(section)) names.add(name);
  return [...names];
}

/** Return a map from callback name to its one-line description. */
function descriptionsByCallback(section: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const [name, desc] of bulletEntries(section)) map.set(name, desc);
  return map;
}

function* bulletEntries(
  section: string,
): Generator<[string, string], void, undefined> {
  for (const line of section.split("\n")) {
    const bullet = /^\s*-\s+`([^(`]+)(\(([^)]*)\))?`\s*(.*)$/.exec(line);
    if (bullet) yield [bullet[1], (bullet[4] ?? "").trim()];
  }
}

test.describe("SDK docs: Events section completeness", () => {
  test("source declares exactly the expected six public callbacks", () => {
    const discovered = discoverPublicCallbacks(
      readFileSync(CLIENT_PATH, "utf8"),
    );
    // Set equality with the hardcoded expected list: adding or removing a
    // public `on*` callback on ZeroHubClient fails this test until the list
    // (and the docs) are updated.
    expect(discovered.sort()).toEqual([...EXPECTED_CALLBACKS].sort());
  });

  test("docs Events section documents every public callback", () => {
    const source = readFileSync(CLIENT_PATH, "utf8");
    const docs = readFileSync(DOCS_PATH, "utf8");
    const section = extractEventsSection(docs);

    const discovered = discoverPublicCallbacks(source);
    const documented = documentedCallbacks(section);

    const missing = discovered.filter((n) => !documented.includes(n));
    expect(missing).toEqual([]);
  });

  test("each documented event callback has a non-empty description", () => {
    const docs = readFileSync(DOCS_PATH, "utf8");
    const section = extractEventsSection(docs);
    const descriptions = descriptionsByCallback(section);

    for (const name of EXPECTED_CALLBACKS) {
      const desc = descriptions.get(name);
      expect(
        desc,
        `callback ${name} is missing or has an empty description`,
      ).toMatch(/\S/);
    }
  });

  test("onOffer/onAnswer document their completing call", () => {
    const docs = readFileSync(DOCS_PATH, "utf8");
    const section = extractEventsSection(docs);
    const descriptions = descriptionsByCallback(section);

    expect(descriptions.get("onOffer")).toMatch(/sendAnswer/);
    expect(descriptions.get("onAnswer")).toMatch(/acceptAnswer/);
  });
});

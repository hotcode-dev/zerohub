import { describe, expect, it } from "vitest";
import { ZeroHubLogger, LogLevel, type Logger } from "./index";

// Regression guard for the public package entry point: Config's documented
// `logger: Logger` field (docs/src/content/docs/api-reference/sdk.md) must be
// reachable from the root export — importing `Logger` from "@zero-hub/client"
// used to fail, forcing users onto the undocumented "@zero-hub/client/logger"
// subpath. If the re-export in index.ts is ever removed, this file fails
// typechecking (the Logger import) and the runtime assertions below.
describe("package entry point exports", () => {
  it("exports ZeroHubLogger as a constructible value", () => {
    expect(typeof ZeroHubLogger).toBe("function");
  });

  it("exports LogLevel usable with a custom Logger", () => {
    const seen: [level: string, message: string][] = [];
    // `unknown` params satisfy the any-typed Logger signature while
    // staying lint-clean.
    const logger: Logger = {
      log: (m?: unknown) => seen.push(["log", String(m)]),
      warn: (m?: unknown) => seen.push(["warn", String(m)]),
      error: (m?: unknown) => seen.push(["error", String(m)]),
    };

    // At Error level only error() is emitted.
    const z = new ZeroHubLogger(logger, LogLevel.Error);
    z.log("debug-only");
    z.warn("warn-only");
    z.error("boom");
    expect(seen).toEqual([["error", "boom"]]);

    // At Debug level all three levels are emitted.
    const all: [level: string, message: string][] = [];
    const allLogger: Logger = {
      log: (m?: unknown) => all.push(["log", String(m)]),
      warn: (m?: unknown) => all.push(["warn", String(m)]),
      error: (m?: unknown) => all.push(["error", String(m)]),
    };
    const d = new ZeroHubLogger(allLogger, LogLevel.Debug);
    d.log("d");
    d.warn("w");
    d.error("e");
    expect(all).toEqual([
      ["log", "d"],
      ["warn", "w"],
      ["error", "e"],
    ]);
  });
});

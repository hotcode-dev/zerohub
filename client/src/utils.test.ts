import { describe, expect, it } from "vitest";
import { getWS, isWellFormedHost } from "./utils";

describe("getWS", () => {
  it("uses wss:// when tls is enabled", () => {
    expect(getWS("localhost:8080", true)).toBe("wss://localhost:8080");
    expect(getWS("sg1.zerohub.dev", true)).toBe("wss://sg1.zerohub.dev");
  });

  it("uses ws:// when tls is disabled", () => {
    expect(getWS("localhost:8080", false)).toBe("ws://localhost:8080");
    expect(getWS("a.com", false)).toBe("ws://a.com");
  });
});

describe("isWellFormedHost", () => {
  it("accepts a bare hostname or host:port", () => {
    expect(isWellFormedHost("localhost:8080")).toBe(true);
    expect(isWellFormedHost("sg1.zerohub.dev")).toBe(true);
    expect(isWellFormedHost("a.com:80")).toBe(true);
  });

  it("rejects scheme, path, query, fragment, userinfo, bad port and control chars", () => {
    const malformed = [
      "",
      "http://a.com",
      "a.com/path",
      "a.com?x=1",
      "a.com#frag",
      "user@a.com",
      "a.com:8080/",
      "a.com:70000",
      "a.com\u0000",
      "Server going away",
    ];
    for (const host of malformed) {
      expect(isWellFormedHost(host)).toBe(false);
    }
  });
});

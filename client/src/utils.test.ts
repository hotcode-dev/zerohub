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

  it("accepts non-canonical-but-valid forms the server accepts", () => {
    const valid = [
      "NEW.example.com",
      "[A:1:2:3:4:5:6:7]:80",
      "a.com:00080",
      "a.com:01",
      "[::1]:08080",
      "10.001.001.001",
      "010.001.001.001",
      "host.com:012345",
      "a.com:0",
      "[::1]",
      "localhost:8080",
      "sg1.zerohub.dev",
      // Bare non-ASCII hostnames (no percent sign) round-trip to the same
      // target once embedded in ws(s)://<host>, matching the server's
      // validateBackupHost, which accepts them.
      "A\u00DC.COM",
      "\u00FC.com",
    ];
    for (const host of valid) {
      expect(isWellFormedHost(host)).toBe(true);
    }
  });

  it("rejects percent-encoded host spellings", () => {
    // WHATWG percent-*decodes* the host, so ws(s)://new%41example.com would
    // resolve to a different (or throwing) target than the server emitted.
    // This is an intentional divergence: the server stores the already
    // URL-decoded value, so these raw percent forms never reach the client
    // via the migration close reason.
    const malformed = ["new%41example.com", "a%C3%BC.com"];
    for (const host of malformed) {
      expect(isWellFormedHost(host)).toBe(false);
    }
  });

  it("rejects a bare empty hostname (port with no host)", () => {
    // Go's validateBackupHost accepts ":80" (empty hostname, a latent server
    // quirk), but ws(s)://:80 is an invalid URL, so the client must refuse it
    // and fall back to host-failover rather than throw on connect.
    const malformed = [":80", ":0", ":65535"];
    for (const host of malformed) {
      expect(isWellFormedHost(host)).toBe(false);
    }
  });
});

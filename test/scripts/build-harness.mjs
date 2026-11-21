import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const distDir = path.resolve(rootDir, "dist");

// Entry points bundled into a browser artifact under dist/:
//  - "harness":      the E2E harness that drives a real ZeroHubClient.
//  - "unit-harness": the in-page unit harness (mocked RTCPeerConnection +
//                    window.ZeroHubUnitHarness driver) injected via
//                    page.addInitScript.
const HARNESS_TARGETS = ["harness", "unit-harness"];

await mkdir(distDir, { recursive: true });

for (const name of HARNESS_TARGETS) {
  await build({
    entryPoints: [path.resolve(rootDir, name, "index.ts")],
    outfile: path.resolve(distDir, `${name}.js`),
    bundle: true,
    sourcemap: true,
    target: "es2022",
    format: "esm",
    platform: "browser",
    logLevel: "info",
  });
}

import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const harnessDir = path.resolve(rootDir, "harness");
const distDir = path.resolve(rootDir, "dist");

await mkdir(distDir, { recursive: true });

await build({
  entryPoints: [path.resolve(harnessDir, "index.ts")],
  outfile: path.resolve(distDir, "harness.js"),
  bundle: true,
  sourcemap: true,
  target: "es2022",
  format: "esm",
  platform: "browser",
  logLevel: "info",
});

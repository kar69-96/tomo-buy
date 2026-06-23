import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The e2e/ harness lives outside the pnpm workspace packages, so @tomo/planner
// isn't hoisted to the root node_modules. Alias it to its built entry so the
// (otherwise self-skipping) e2e specs can be collected. Requires `pnpm build`.
const tomoPlanner = resolve(process.cwd(), "packages/planner/dist/index.js");

// Load .env into process.env before tests evaluate
try {
  const envFile = readFileSync(resolve(process.cwd(), ".env"), "utf-8");
  for (const line of envFile.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx);
    const value = trimmed.slice(eqIdx + 1);
    if (!process.env[key]) process.env[key] = value;
  }
} catch {
  // .env is optional
}

export default defineConfig({
  resolve: {
    alias: {
      "@tomo/planner": tomoPlanner,
    },
  },
  test: {
    include: [
      "packages/*/tests/**/*.test.ts",
      // Live, headful, no-spend end-to-end scenarios. These self-skip unless
      // E2E_LIVE=1, so a normal `pnpm test` run never launches a browser.
      "e2e/scenarios/**/*.e2e.test.ts",
    ],
    fileParallelism: false,
    // E2E scenarios drive a real browser + real LLM and can take minutes.
    testTimeout:
      process.env.E2E_LIVE === "1" ? Number(process.env.E2E_TIMEOUT_MS ?? 900_000) : 10_000,
  },
});

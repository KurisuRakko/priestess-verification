import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          CAP_SECRET: "test-cap-secret-0123456789abcdef",
          SITEVERIFY_SECRET: "test-siteverify-secret-0123456789abcdef",
          // Solve for real in tests, but with a tiny workload: 5 challenges of
          // difficulty 2 (production defaults are 50 x difficulty 4).
          CHALLENGE_COUNT: "5",
          CHALLENGE_DIFFICULTY: "2",
        },
      },
    }),
  ],
  test: {
    testTimeout: 30_000,
  },
});

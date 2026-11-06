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
          // Tests mint gate tokens with `instr_blocked: true`; the default
          // (blocking automated browsers) has its own test that overrides this.
          GATE_BLOCK_AUTOMATED_BROWSERS: "false",
        },
      },
    }),
  ],
  test: {
    testTimeout: 30_000,
  },
});

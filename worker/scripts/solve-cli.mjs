/**
 * CLI helper: solve one challenge against a running Worker and print the
 * redeem result as JSON.
 *
 *   node scripts/solve-cli.mjs http://127.0.0.1:8787
 */

import { solveAndRedeem } from "./solve.js";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:8787";

const result = await solveAndRedeem(baseUrl);
console.log(
  JSON.stringify(
    {
      redeemStatus: result.redeemStatus,
      redeem: result.redeem,
      token: result.redeem.token ?? null,
    },
    null,
    2,
  ),
);

if (!result.redeem.success) process.exit(1);

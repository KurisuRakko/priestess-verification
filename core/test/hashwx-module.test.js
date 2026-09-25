import { describe, expect, test } from "bun:test";
import { verifyHashwxSolution } from "../src/hashwx.js";
import { HASHWX_WASM_BASE64 } from "../src/hashwx-wasm.js";
import {
  hashwxHash,
  hashwxReady,
  hashwxSeed,
  hashwxTarget,
  setHashwxModule,
} from "../src/index.js";

const SPEC = { c: "00".repeat(32), d: 1000, n: 65536 };

describe("setHashwxModule", () => {
  test("rejects anything that is not a WebAssembly.Module", () => {
    expect(() => setHashwxModule({})).toThrow(TypeError);
    expect(() => setHashwxModule(new Uint8Array(4))).toThrow(TypeError);
    expect(() => setHashwxModule(null)).toThrow(TypeError);
  });

  test("uses the injected module instead of WebAssembly.compile()", async () => {
    const module = await WebAssembly.compile(
      Buffer.from(HASHWX_WASM_BASE64, "base64"),
    );
    setHashwxModule(module);

    // Runtimes that forbid runtime compilation (Cloudflare Workers) must never
    // reach the embedded base64 path once a module is injected.
    const originalCompile = WebAssembly.compile;
    WebAssembly.compile = () => {
      throw new Error("WebAssembly.compile() must not be called");
    };
    try {
      const state = await hashwxReady();
      const challenge = new Uint8Array(32);
      const target = hashwxTarget(SPEC.d);
      let nonce = 0n;
      while (
        hashwxHash(state, hashwxSeed(challenge, nonce / 65536n), nonce) > target
      ) {
        nonce++;
      }
      expect(
        await verifyHashwxSolution(SPEC, { nonce: nonce.toString() }),
      ).toBe(true);
      expect(await verifyHashwxSolution(SPEC, { nonce: "-1" })).toBe(false);
    } finally {
      WebAssembly.compile = originalCompile;
    }
  });
});

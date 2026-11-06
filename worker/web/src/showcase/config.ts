/** One widget variant, as `demo-page.js` lists them in `#page-config`. */
export interface Variant {
  id: string;
  tags: string[];
  mascot?: boolean;
  auto?: boolean;
  bare?: boolean;
  /** Programmatic `new Cap()`, nothing rendered. */
  invisible?: boolean;
}

/** `#page-config` of the showcase page. */
export interface ShowcaseConfig {
  /** `/demo/`: issues demo-scoped tokens, the only kind `siteverify` accepts. */
  endpoint: string;
  /** `/demo/siteverify`: same-origin-only server-side verification. */
  siteverify: string;
  repo: string;
  variants: Variant[];
}

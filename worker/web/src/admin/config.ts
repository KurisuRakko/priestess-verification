/**
 * `#page-config` of the console (`admin/page.js`): which view the bundle
 * renders. `/admin` is the console (sign-in panel or tabs), `/admin/callback`
 * finishes a Priestess sign-in.
 */
export interface AdminConfig {
  view: "console" | "callback";
}

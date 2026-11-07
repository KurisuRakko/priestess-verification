/**
 * `/admin/callback`: Priestess puts `login_code` and `state` in the URL
 * fragment. The page takes them out of the address bar straight away, posts
 * them to `/admin/api/session` and moves on to the console; on any error it
 * goes to `/admin?error=<code>` instead of starting another login, so a
 * denied user never loops.
 */

export function doneUrl(error: string | null): string {
  return error ? `/admin?error=${encodeURIComponent(error)}` : "/admin";
}

/** Where to go once the fragment `hash` has been handled. */
export async function finishSignIn(
  hash: string,
  post: typeof fetch = fetch,
): Promise<string> {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const authError = params.get("auth_error");
  if (authError) return doneUrl(authError);
  const loginCode = params.get("login_code");
  if (!loginCode) return doneUrl("missing_login_code");
  try {
    const res = await post("/admin/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        login_code: loginCode,
        state: params.get("state") || "",
      }),
      credentials: "same-origin",
    });
    const body: { error?: string } = await res.json();
    return doneUrl(res.ok ? null : body.error || "sign_in_failed");
  } catch {
    return doneUrl("network_error");
  }
}

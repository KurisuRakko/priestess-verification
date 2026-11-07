import { ApiError, Unauthenticated } from "./errors";

/**
 * `/admin/api/*` from the console. Every non-GET call carries a JSON body
 * with `Content-Type: application/json`: the router refuses anything else
 * (admin/index.js), which is what keeps other origins out.
 *
 * A 401 means the session is gone: `onUnauthenticated` (set once by the app)
 * switches to the sign-in panel and the call throws `Unauthenticated`, which
 * callers ignore. Any other failure throws `ApiError`.
 */
let onUnauthenticated: () => void = () => {};

export function setUnauthenticatedHandler(handler: () => void): void {
  onUnauthenticated = handler;
}

export type Method = "GET" | "POST" | "PATCH" | "DELETE";

export async function api<T>(
  path: string,
  { method = "GET", body }: { method?: Method; body?: unknown } = {},
): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin" };
  if (method !== "GET") {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body ?? {});
  }
  let res: Response;
  try {
    res = await fetch(`/admin/api${path}`, init);
  } catch (error) {
    throw new ApiError(error instanceof Error ? error.message : "", null);
  }
  let data: { error?: string } | null = null;
  try {
    data = await res.json();
  } catch {}
  if (res.status === 401) {
    onUnauthenticated();
    throw new Unauthenticated();
  }
  if (!res.ok) {
    throw new ApiError(data?.error || `HTTP ${res.status}`, res.status);
  }
  return data as T;
}

export function isUnauthenticated(error: unknown): boolean {
  return error instanceof Unauthenticated;
}

/** The API's error text, as the console showed it before (toasts). */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

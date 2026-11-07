/**
 * Admin API for the server-side gate's hosts. Every route here runs behind
 * `readAdminSession` (see `admin/index.js`).
 *
 *   GET    /admin/api/gate          { selfHosts, hosts } (config + admin hosts)
 *   POST   /admin/api/gate          { host, upstream, exemptPaths?, enabled? } -> 201 { host }
 *   PATCH  /admin/api/gate/<host>   { upstream?, exemptPaths?, enabled? } -> { host }
 *   DELETE /admin/api/gate/<host>   -> { ok: true }
 *
 * Hosts from `GATE_UPSTREAMS` are listed with `source: "config"` and are
 * read-only here (409). Every write drops this isolate's gate host snapshot;
 * other isolates pick the change up within `GATE_CACHE_TTL_MS`.
 */

import {
  forgetGateHosts,
  MAX_GATE_HOSTS,
  mergeGateHosts,
  selfHosts,
  validateEnabled,
  validateExemptPaths,
  validateGateHost,
  validateUpstream,
} from "../gate-hosts.js";
import { registryFor } from "../site-registry.js";
import { ValidationError } from "../sites.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function isoOrNull(ms) {
  return typeof ms === "number" ? new Date(ms).toISOString() : null;
}

function publicGateHost(entry) {
  return {
    host: entry.host,
    upstream: entry.upstream,
    exemptPaths: entry.exemptPaths,
    enabled: entry.enabled,
    source: entry.source,
    createdAt: isoOrNull(entry.createdAt),
    updatedAt: isoOrNull(entry.updatedAt),
  };
}

async function readBody(request) {
  try {
    const body = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body;
  } catch {
    // fall through
  }
  throw new ValidationError("invalid JSON body");
}

const CONFIG_READ_ONLY = "host is managed by the deployment configuration";

async function createGateHost(request, config, registry) {
  const body = await readBody(request);
  const host = validateGateHost(body.host, config);
  const upstream = validateUpstream(body.upstream, host);
  const exemptPaths = validateExemptPaths(body.exemptPaths);
  const enabled = "enabled" in body ? validateEnabled(body.enabled) : true;
  if (config.gateUpstreams.has(host)) {
    return json({ error: CONFIG_READ_ONLY }, 409);
  }
  if ((await registry.listGateHosts()).length >= MAX_GATE_HOSTS) {
    throw new ValidationError(`at most ${MAX_GATE_HOSTS} gate hosts`);
  }
  const created = await registry.createGateHost({
    host,
    upstream,
    exemptPaths,
    enabled,
  });
  forgetGateHosts();
  if (!created) return json({ error: "host already exists" }, 409);
  const entry = await registry.getGateHost(host);
  return json({ host: publicGateHost({ ...entry, source: "admin" }) }, 201);
}

async function updateGateHost(request, registry, host) {
  const body = await readBody(request);
  const patch = {};
  if ("upstream" in body)
    patch.upstream = validateUpstream(body.upstream, host);
  if ("exemptPaths" in body) {
    patch.exemptPaths = validateExemptPaths(body.exemptPaths);
  }
  if ("enabled" in body) patch.enabled = validateEnabled(body.enabled);
  const entry = await registry.updateGateHost(host, patch);
  forgetGateHosts();
  if (!entry) return json({ error: "host not found" }, 404);
  return json({ host: publicGateHost({ ...entry, source: "admin" }) });
}

/** Routes `/admin/api/gate…`; `null` when nothing matches. */
export async function handleGateApi(request, env, config, pathname) {
  const registry = registryFor(env);
  const parts = pathname.split("/").slice(4); // "", admin, api, gate, …
  const method = request.method;

  try {
    if (parts.length === 0) {
      if (method === "GET") {
        const hosts = mergeGateHosts(config, await registry.listGateHosts());
        return json({
          selfHosts: [...selfHosts(config)],
          hosts: hosts.map(publicGateHost),
        });
      }
      if (method === "POST") {
        return await createGateHost(request, config, registry);
      }
      return json({ error: "method not allowed" }, 405);
    }

    if (parts.length !== 1 || !parts[0]) return null;
    const host = parts[0].toLowerCase();

    if (method !== "PATCH" && method !== "DELETE") {
      return json({ error: "method not allowed" }, 405);
    }
    if (config.gateUpstreams.has(host)) {
      return json({ error: CONFIG_READ_ONLY }, 409);
    }
    if (method === "PATCH")
      return await updateGateHost(request, registry, host);
    const deleted = await registry.deleteGateHost(host);
    forgetGateHosts();
    return deleted
      ? json({ ok: true })
      : json({ error: "host not found" }, 404);
  } catch (error) {
    if (error instanceof ValidationError) {
      return json({ error: error.message }, 400);
    }
    throw error;
  }
}

import { StorageError } from "./errors.js";
import type { Logger } from "./logging.js";
import type { FilewayHandler, FilewayPlugin, PluginContext, PluginRoute } from "./types.js";

// Internal: plugin validation, the route table and `client.handler`.

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

interface RouteEntry {
  method: string;
  /** Exact path, or for a wildcard route the prefix ending in "/". */
  path: string;
  wildcard: boolean;
  handler: PluginRoute;
}

/** Checks plugin ids and builds the route table; throws `config` errors on clashes. */
export function buildRoutes(plugins: FilewayPlugin[]): RouteEntry[] {
  const ids = new Set<string>();
  const routes: RouteEntry[] = [];
  const seen = new Set<string>();
  for (const plugin of plugins) {
    if (!plugin.id || typeof plugin.id !== "string") {
      throw new StorageError("config", "every plugin needs a non-empty string id");
    }
    if (ids.has(plugin.id)) throw new StorageError("config", `two plugins share the id "${plugin.id}"`);
    ids.add(plugin.id);

    for (const [key, handler] of Object.entries(plugin.routes ?? {})) {
      const match = key.match(/^([A-Z]+) (\/\S*)$/);
      const method = match?.[1];
      const rawPath = match?.[2];
      if (!method || !rawPath || !(METHODS as readonly string[]).includes(method)) {
        throw new StorageError(
          "config",
          `plugin "${plugin.id}" route "${key}" must look like "GET /path" or "GET /path/*" with method ${METHODS.join(", ")}`,
        );
      }
      const wildcard = rawPath.endsWith("/*");
      const path = wildcard ? rawPath.slice(0, -1) : rawPath;
      const id = `${method} ${rawPath}`;
      if (seen.has(id)) throw new StorageError("config", `route "${id}" is registered twice (plugin "${plugin.id}")`);
      seen.add(id);
      routes.push({ method, path, wildcard, handler });
    }
  }
  return routes;
}

/** The web-standard handler that serves plugin routes under `basePath`. */
export function createHandler(
  routes: RouteEntry[],
  basePath: string,
  ctx: PluginContext,
  log: Logger,
): FilewayHandler {
  const base = basePath.replace(/\/+$/, "");

  const handle = async (request: Request): Promise<Response> => {
    const { pathname } = new URL(request.url);
    if (base && pathname !== base && !pathname.startsWith(`${base}/`)) return error(404, "not_found");
    const path = pathname.slice(base.length) || "/";

    // Exact routes win over wildcard ones.
    const exact = routes.filter((r) => !r.wildcard && r.path === path);
    const wild = routes.filter((r) => r.wildcard && path.startsWith(r.path) && path.length > r.path.length);
    const candidates = exact.length > 0 ? exact : wild;
    if (candidates.length === 0) return error(404, "not_found");

    const route = candidates.find((r) => r.method === request.method);
    if (!route) {
      const allow = [...new Set(candidates.map((r) => r.method))].join(", ");
      return error(405, "method_not_allowed", { allow });
    }
    try {
      return await route.handler(request, {
        ...ctx,
        params: route.wildcard ? { wildcard: path.slice(route.path.length) } : {},
      });
    } catch (err) {
      log.error?.("plugin route failed", {
        method: request.method,
        path,
        error: err instanceof Error ? { name: err.name, message: err.message } : String(err),
      });
      return error(500, "internal_error");
    }
  };

  return {
    fetch: handle,
    GET: handle,
    POST: handle,
    PUT: handle,
    PATCH: handle,
    DELETE: handle,
    HEAD: handle,
    OPTIONS: handle,
  };
}

function error(status: number, code: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

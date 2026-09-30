/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * Runtime MCP adapter - creates SDK clients, selects transport, wires OAuth.
 *
 * Contract: createMcpConnection(server, config?) → McpConnection
 * Invariant: Throws on connection failure; never exposes SDK internals.
 */

import {
  Client,
  DEFAULT_REQUEST_TIMEOUT_MSEC,
  SSEClientTransport,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  type Prompt,
  type RequestOptions,
  type Resource,
  type ServerCapabilities,
  type Tool,
} from "@modelcontextprotocol/client";
import {
  browserAuth,
  type BrowserAuth,
  type BrowserAuthOptions,
  type CredentialStore,
} from "oauth-callback/mcp";
import type { McpServerConfig } from "./types.js";

/**
 * Loopback redirect used when `oauth.redirectUri` is omitted. The port is fixed because
 * Dynamic Client Registration records the exact URI.
 */
const DEFAULT_REDIRECT_URI = "http://127.0.0.1:3000/callback";

/** Authorizations one capability listing may complete before giving up. */
const MAX_AUTHORIZATIONS = 3;

/** Hosts where oauth-callback allows plain `http:` (bearer tokens stay on this machine). */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** `browserAuth()` options; `serverUrl` comes from the server config. */
export interface McpOAuthOptions extends Omit<
  Partial<BrowserAuthOptions>,
  "serverUrl" | "store"
> {
  /**
   * Credential store per server. A factory, because oauth-callback binds a store to one
   * server and a config is shared by every server in `generateClient()`. Default: memory.
   */
  store?: (server: McpServerConfig) => CredentialStore;
}

export interface McpClientConfig {
  /** Client identifier sent to servers; also the OAuth client name for registration */
  name?: string;
  /** Client version for compatibility checks */
  version?: string;
  /** OAuth 2.1 browser authorization settings */
  oauth?: McpOAuthOptions;
  /** Custom fetch for proxies/interceptors */
  fetch?: typeof fetch;
  /** Per-request timeout in ms (SDK default: 60s) */
  timeout?: number;
}

export interface McpConnection {
  client: Client;
  server: McpServerConfig;
  /** Server-advertised capabilities (empty object if none advertised) */
  capabilities: ServerCapabilities;
  tools: Tool[];
  resources: Resource[];
  prompts: Prompt[];
  /**
   * Completes an authorization the server demanded after connecting (a request failed with
   * `UnauthorizedError`, e.g. a 403 step-up over Streamable HTTP or a 401 over SSE); then
   * retry that request. Resolves at once without OAuth.
   */
  authorize(): Promise<void>;
}

/**
 * Wrap fetch to inject headers for every request; request headers win.
 */
function createFetchWithHeaders(
  baseFetch: typeof fetch | undefined,
  headers: Record<string, string>,
): typeof fetch {
  const originalFetch = baseFetch || globalThis.fetch;
  return ((url: URL | string, init?: RequestInit) => {
    // Headers instances don't spread, so merge through the Headers API
    const merged = new Headers(headers);
    new Headers(init?.headers).forEach((value, key) => merged.set(key, value));
    return originalFetch(url, { ...init, headers: merged });
  }) as typeof fetch;
}

/**
 * Bound the wait for response headers, not the body: a stalled token exchange fails,
 * while an SSE stream stays open after its headers arrive.
 */
function createFetchWithHeaderTimeout(
  baseFetch: typeof fetch | undefined,
  ms: number,
): typeof fetch {
  const originalFetch = baseFetch || globalThis.fetch;
  return (async (url: URL | string, init?: RequestInit) => {
    const timeout = new AbortController();
    const timer = setTimeout(
      () =>
        timeout.abort(new DOMException("Request timed out", "TimeoutError")),
      ms,
    );
    const signal = init?.signal
      ? AbortSignal.any([init.signal, timeout.signal])
      : timeout.signal;
    try {
      return await originalFetch(url, { ...init, signal });
    } finally {
      clearTimeout(timer);
    }
  }) as typeof fetch;
}

/**
 * Establish MCP connection with capability discovery.
 * @param server Server config (http/sse with URL)
 * @param config Client options (auth, timeout, etc)
 * @returns Connected client with introspected capabilities
 * @throws On unsupported server type or connection failure
 */
export async function createMcpConnection(
  server: McpServerConfig,
  config: McpClientConfig = {},
): Promise<McpConnection> {
  if (server.type !== "http" && server.type !== "sse") {
    throw new Error(`Unsupported server type: ${server.type}`);
  }

  const clientInfo = {
    name: config.name || "mcp-client-gen",
    version: config.version || "1.0.0",
  };

  // OAuth only where tokens can't leak (https: or loopback http:); elsewhere, e.g. a
  // private-network http: server, connect unauthenticated (server.headers still apply).
  const url = new URL(server.url);
  const { store, ...oauth } = config.oauth ?? {};
  const auth =
    url.protocol === "https:" || LOOPBACK_HOSTS.has(url.hostname)
      ? browserAuth({
          ...oauth,
          serverUrl: url,
          redirectUri: oauth.redirectUri ?? DEFAULT_REDIRECT_URI,
          // clientName and clientInformation are exclusive; default the name only for DCR
          ...(!oauth.clientInformation && {
            clientName: oauth.clientName ?? clientInfo.name,
          }),
          store: store?.(server),
        })
      : undefined;

  const requestOptions: RequestOptions = config.timeout
    ? { timeout: config.timeout }
    : {};

  // Server advertises its capabilities during the handshake
  const client = new Client(clientInfo, { capabilities: {} });

  // Completes a pending step-up on the live connection (see McpConnection.authorize)
  let completeAuthorization: (() => Promise<void>) | undefined;
  if (server.type === "http") {
    const transportOptions = {
      fetch: config.fetch,
      ...(server.headers && { requestInit: { headers: server.headers } }),
    };
    if (auth) {
      // Runs the browser flow when the server demands it; on a connected client it
      // completes a pending step-up instead of reconnecting
      const connect = () =>
        auth.connect(client, { ...requestOptions, transportOptions });
      await connect();
      completeAuthorization = connect;
    } else {
      await client.connect(
        new StreamableHTTPClientTransport(url, transportOptions),
        requestOptions,
      );
    }
  } else {
    const transport = await connectSse(
      client,
      auth,
      url,
      server,
      config,
      requestOptions,
    );
    if (auth)
      completeAuthorization = () => auth.completeAuthorization(transport);
  }

  // Concurrent callers share one completion: on SSE, overlapping completions are unsupported
  let pending: Promise<void> | undefined;
  const authorize = async () => {
    if (!completeAuthorization) return;
    pending ??= completeAuthorization().finally(() => (pending = undefined));
    return pending;
  };

  // Every UnauthorizedError leaves a browser flow pending, and oauth-callback can't cancel
  // one short of signing out: complete it (approval or timeout) so none outlives the
  // connection. Bounded, since a server may keep demanding scopes.
  const withAuthorization = async <T>(request: () => Promise<T>) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await request();
      } catch (error) {
        if (!completeAuthorization || !(error instanceof UnauthorizedError))
          throw error;
        await authorize();
        if (attempt === MAX_AUTHORIZATIONS) throw error;
      }
    }
  };

  try {
    // Fetch advertised capabilities; a listing failure is a connection error.
    // Sequential: OAuth refreshes on a caller-owned (SSE) transport must not overlap.
    // List calls without a cursor return every page.
    const capabilities = client.getServerCapabilities() ?? {};
    const tools = capabilities.tools
      ? (
          await withAuthorization(() =>
            client.listTools(undefined, requestOptions),
          )
        ).tools
      : [];
    const resources = capabilities.resources
      ? (
          await withAuthorization(() =>
            client.listResources(undefined, requestOptions),
          )
        ).resources
      : [];
    const prompts = capabilities.prompts
      ? (
          await withAuthorization(() =>
            client.listPrompts(undefined, requestOptions),
          )
        ).prompts
      : [];

    return {
      client,
      server,
      capabilities,
      tools,
      resources,
      prompts,
      authorize,
    };
  } catch (error) {
    await client.close().catch(() => {}); // don't mask the listing error
    throw error;
  }
}

/**
 * SSE (deprecated in MCP, still supported): `auth.connect()` only speaks Streamable HTTP,
 * so complete the browser flow on the transport that got the 401, then reconnect.
 */
async function connectSse(
  client: Client,
  auth: BrowserAuth | undefined,
  url: URL,
  server: McpServerConfig,
  config: McpClientConfig,
  requestOptions: RequestOptions,
): Promise<SSEClientTransport> {
  const baseFetch = server.headers
    ? createFetchWithHeaders(config.fetch, server.headers)
    : config.fetch;
  // completeAuthorization() can't interrupt this transport's token exchange: bound it here
  const fetch = createFetchWithHeaderTimeout(
    baseFetch,
    config.timeout ?? DEFAULT_REQUEST_TIMEOUT_MSEC,
  );
  const createTransport = () =>
    new SSEClientTransport(url, { authProvider: auth, fetch });

  const transport = createTransport();
  try {
    await client.connect(transport, requestOptions);
    return transport;
  } catch (error) {
    try {
      if (!auth || !(error instanceof UnauthorizedError)) throw error;
      await auth.completeAuthorization(transport);
    } finally {
      await closeQuietly(transport);
    }
    const retry = createTransport();
    await client.connect(retry, requestOptions).catch(async (e: unknown) => {
      await closeQuietly(retry);
      throw e;
    });
    return retry;
  }
}

/** A failed SSE start keeps reconnecting until closed; close errors mustn't mask the cause. */
async function closeQuietly(transport: SSEClientTransport): Promise<void> {
  await transport.close().catch(() => {});
}

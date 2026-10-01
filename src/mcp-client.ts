/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * Generation-time MCP connection - creates the SDK client, selects the transport and
 * wires OAuth. Listing capabilities is introspection's job. Internal: generated clients
 * take the caller's own SDK `Client` (ADR-003).
 *
 * Contract: connectMcp(server, options?) → McpSession
 * Invariant: Throws on connection failure, having closed the client.
 */

import {
  Client,
  DEFAULT_REQUEST_TIMEOUT_MSEC,
  SSEClientTransport,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  type RequestOptions,
} from "@modelcontextprotocol/client";
import { browserAuth, type BrowserAuth } from "oauth-callback/mcp";
import { version } from "../package.json" with { type: "json" };
import type { GenerateClientOptions, McpServerConfig } from "./types.js";

/**
 * Loopback redirect used when `oauth.redirectUri` is omitted. The port is fixed because
 * Dynamic Client Registration records the exact URI.
 */
const DEFAULT_REDIRECT_URI = "http://127.0.0.1:3000/callback";

/** Hosts where oauth-callback allows plain `http:` (bearer tokens stay on this machine). */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** A connected client, and what requests on it need. */
export interface McpSession {
  client: Client;
  /** `timeout` and `signal` for each request */
  requestOptions: RequestOptions;
  /**
   * Completes the browser flow an `UnauthorizedError` left pending (e.g. a step-up);
   * absent without OAuth
   */
  completeAuthorization?: () => Promise<void>;
  /** Whether requests carry OAuth tokens */
  authorized: () => Promise<boolean>;
}

/**
 * Wrap fetch to add `headers` to requests for `origin`; a `Request`'s own headers win,
 * and `init.headers` over both. Other origins (OAuth discovery and token endpoints share
 * this fetch) never see them: they are the MCP server's credentials.
 */
export function createFetchWithHeaders(
  baseFetch: typeof fetch | undefined,
  headers: Record<string, string>,
  origin: string,
): typeof fetch {
  const originalFetch = baseFetch || globalThis.fetch;
  return ((url: URL | string | Request, init?: RequestInit) => {
    const target = new URL(url instanceof Request ? url.url : url);
    if (target.origin !== origin) return originalFetch(url, init);
    // Headers instances don't spread, so merge through the Headers API
    const merged = new Headers(headers);
    const set = (value: string, key: string) => merged.set(key, value);
    if (url instanceof Request) url.headers.forEach(set);
    new Headers(init?.headers).forEach(set);
    return originalFetch(url, { ...init, headers: merged });
  }) as typeof fetch;
}

/**
 * End every request when `signal` aborts: the SDK doesn't pass its request signal to
 * all handshake traffic (e.g. `notifications/initialized`).
 */
function createFetchWithSignal(
  baseFetch: typeof fetch | undefined,
  signal: AbortSignal,
): typeof fetch {
  const originalFetch = baseFetch || globalThis.fetch;
  return ((url: URL | string, init?: RequestInit) =>
    originalFetch(url, {
      ...init,
      signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal,
    })) as typeof fetch;
}

/**
 * Bound each request, except an event stream's body: a stalled token exchange (headers
 * or body) fails, while an SSE stream stays open once its headers arrive. `abort` also
 * ends any request.
 */
function createFetchWithTimeout(
  baseFetch: typeof fetch | undefined,
  ms: number,
  abort: AbortSignal | undefined,
): typeof fetch {
  const originalFetch = baseFetch || globalThis.fetch;
  return (async (url: URL | string, init?: RequestInit) => {
    const timeout = new AbortController();
    const timer = setTimeout(
      () =>
        timeout.abort(new DOMException("Request timed out", "TimeoutError")),
      ms,
    );
    const signal = AbortSignal.any(
      [init?.signal, abort, timeout.signal].filter((s) => s != null),
    );
    try {
      const response = await originalFetch(url, { ...init, signal });
      if (response.headers.get("content-type")?.startsWith("text/event-stream"))
        return response;
      // Finite body (JSON, errors): read it within the same deadline
      const nullBody = [204, 205, 304].includes(response.status);
      return new Response(
        nullBody ? null : await response.arrayBuffer(),
        response,
      );
    } finally {
      clearTimeout(timer);
    }
  }) as typeof fetch;
}

/**
 * Connect to an MCP server: Streamable HTTP (negotiating the protocol era) or SSE, with
 * browser OAuth where tokens can't leak.
 * @throws On an unsupported server type or a connection failure
 */
export async function connectMcp(
  server: McpServerConfig,
  options: GenerateClientOptions = {},
): Promise<McpSession> {
  const type = server.type ?? "http";
  if (type !== "http" && type !== "sse") {
    throw new Error(`Unsupported server type: ${type}`);
  }

  const clientInfo = { name: "mcp-client-gen", version };

  // OAuth only where tokens can't leak (https: or loopback http:); elsewhere, e.g. a
  // private-network http: server, connect unauthenticated (server.headers still apply).
  const url = new URL(server.url);
  const oauth = options.oauth ?? {};
  const auth =
    oauth !== false &&
    (url.protocol === "https:" || LOOPBACK_HOSTS.has(url.hostname))
      ? browserAuth({
          ...oauth,
          serverUrl: url,
          redirectUri: oauth.redirectUri ?? DEFAULT_REDIRECT_URI,
          // clientName and clientInformation are exclusive; default the name only for DCR
          ...(!oauth.clientInformation && {
            clientName: oauth.clientName ?? clientInfo.name,
          }),
        })
      : undefined;

  const requestOptions: RequestOptions = {
    ...(options.timeout !== undefined && { timeout: options.timeout }),
    ...(options.signal && { signal: options.signal }),
  };

  // Server advertises its capabilities during the handshake. Over Streamable HTTP,
  // negotiate the newest protocol era the server speaks (2026-07-28 or the legacy
  // fallback): generated types must match what the server exposes today.
  const client = new Client(clientInfo, {
    capabilities: {},
    ...(type === "http" && { versionNegotiation: { mode: "auto" } }),
  });

  try {
    const completeAuthorization =
      type === "http"
        ? await connectHttp(client, auth, url, server, options, requestOptions)
        : await connectSse(client, auth, url, server, options, requestOptions);
    return {
      client,
      requestOptions,
      completeAuthorization,
      // Tokens exist only once a browser flow (or a provided store) authorized us
      authorized: async () => (await auth?.tokens()) !== undefined,
    };
  } catch (error) {
    await client.close().catch(() => {}); // don't mask the cause
    throw error;
  }
}

/** Connect over Streamable HTTP; returns how to complete a later authorization. */
async function connectHttp(
  client: Client,
  auth: BrowserAuth | undefined,
  url: URL,
  server: McpServerConfig,
  options: GenerateClientOptions,
  requestOptions: RequestOptions,
): Promise<(() => Promise<void>) | undefined> {
  // Not `requestInit`: the SDK applies it to OAuth discovery and token requests too
  const signalled = options.signal
    ? createFetchWithSignal(options.fetch, options.signal)
    : options.fetch;
  const transportOptions = {
    fetch: server.headers
      ? createFetchWithHeaders(signalled, server.headers, url.origin)
      : signalled,
  };
  if (!auth) {
    await client.connect(
      new StreamableHTTPClientTransport(url, transportOptions),
      requestOptions,
    );
    return undefined;
  }
  // Runs the browser flow when the server demands it; on a connected client it
  // completes a pending step-up instead of reconnecting
  const connect = () =>
    auth.connect(client, { ...requestOptions, transportOptions });
  await connect();
  return connect;
}

/**
 * SSE (deprecated in MCP, still supported): `auth.connect()` only speaks Streamable HTTP,
 * so complete the browser flow on the transport that got the 401, then reconnect.
 * Returns how to complete a later authorization on the connected transport.
 */
async function connectSse(
  client: Client,
  auth: BrowserAuth | undefined,
  url: URL,
  server: McpServerConfig,
  options: GenerateClientOptions,
  requestOptions: RequestOptions,
): Promise<(() => Promise<void>) | undefined> {
  const baseFetch = server.headers
    ? createFetchWithHeaders(options.fetch, server.headers, url.origin)
    : options.fetch;
  // completeAuthorization() can't interrupt this transport's token exchange: bound it here
  const fetch = createFetchWithTimeout(
    baseFetch,
    options.timeout ?? DEFAULT_REQUEST_TIMEOUT_MSEC,
    options.signal,
  );
  const createTransport = () =>
    new SSEClientTransport(url, { authProvider: auth, fetch });

  const completion = (transport: SSEClientTransport) =>
    auth &&
    (() => auth.completeAuthorization(transport, { signal: options.signal }));

  const transport = createTransport();
  try {
    await client.connect(transport, requestOptions);
    return completion(transport);
  } catch (error) {
    try {
      if (!auth || !(error instanceof UnauthorizedError)) throw error;
      await auth.completeAuthorization(transport, { signal: options.signal });
    } finally {
      await closeQuietly(transport);
    }
    const retry = createTransport();
    await client.connect(retry, requestOptions).catch(async (e: unknown) => {
      await closeQuietly(retry);
      throw e;
    });
    return completion(retry);
  }
}

/** A failed SSE start keeps reconnecting until closed; close errors mustn't mask the cause. */
async function closeQuietly(transport: SSEClientTransport): Promise<void> {
  await transport.close().catch(() => {});
}

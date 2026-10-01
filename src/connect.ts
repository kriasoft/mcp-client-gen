/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * Generation-time MCP connection - creates the SDK client, selects the transport and
 * wires OAuth. Listing capabilities is introspection's job. Internal: generated clients
 * take the caller's own SDK `Client` (ADR-003).
 *
 * Contract: connectMcp(endpoint, options?) → McpSession
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
import {
  browserAuth,
  type BrowserAuth,
  type BrowserAuthOptions,
} from "oauth-callback/mcp";
import { version } from "../package.json" with { type: "json" };

/** Where an MCP server listens, and how to reach it. */
export interface McpEndpoint {
  url: string | URL;
  /** Streamable HTTP (default) or legacy SSE */
  transport?: "http" | "sse";
  /**
   * Added to requests to the server's origin, e.g. a static `Authorization`; never sent
   * to OAuth endpoints elsewhere
   */
  headers?: RequestInit["headers"];
}

/**
 * `browserAuth()` options without `serverUrl`; `redirectUri` and a DCR `clientName` are
 * defaulted. Distributes over its registration union (DCR or a pre-registered client), so
 * each keeps its own fields.
 */
type OAuthOptions = Defaulted<BrowserAuthOptions>;
type Defaulted<O extends BrowserAuthOptions> = O extends unknown
  ? Omit<O, "serverUrl" | "redirectUri" | "clientName"> & {
      redirectUri?: O["redirectUri"];
      clientName?: O["clientName"];
    }
  : never;

/** How to connect: authorization, fetch, and limits on connecting and listing. */
export interface ConnectOptions {
  /**
   * oauth-callback `browserAuth()` options (`serverUrl` comes from the endpoint,
   * `redirectUri` defaults to a fixed loopback URI; a `store` serves this one server).
   * `false` never opens a browser: a server demanding OAuth then fails (e.g. in CI).
   */
  oauth?: false | OAuthOptions;
  /** Custom fetch for proxies/interceptors */
  fetch?: typeof fetch;
  /** Timeout in ms for each request while connecting and listing (SDK default: 60s) */
  timeout?: number;
  /** Aborts connecting and listing, including a pending browser authorization */
  signal?: AbortSignal;
}

/**
 * Loopback redirect for the browser flow; `oauth.redirectUri` defaults to port 3000. The
 * port is fixed because Dynamic Client Registration records the exact URI.
 */
export function oauthRedirectUri(port = 3000): string {
  return `http://127.0.0.1:${port}/callback`;
}

/**
 * Hosts where oauth-callback (like the SDK) allows plain `http:`: bearer tokens stay on
 * this machine. `*.localhost` is loopback by RFC 6761.
 */
const isLoopbackHost = (hostname: string) =>
  ["localhost", "127.0.0.1", "[::1]"].includes(hostname) ||
  hostname.endsWith(".localhost");

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

/** The largest delay `setTimeout` honors; longer ones fire at once. */
const MAX_TIMEOUT = 2 ** 31 - 1;

/**
 * Wrap fetch to add `headers` to requests for `origin`; a `Request`'s own headers win,
 * and `init.headers` over both. Other origins (OAuth discovery and token endpoints share
 * this fetch) never see them: they are the MCP server's credentials.
 *
 * Such requests don't follow redirects: fetch would carry custom headers (only
 * `Authorization` is stripped) to whatever origin the redirect names. Faithfully
 * re-implementing redirects isn't worth it; the fix is configuring the final URL.
 * @throws When the server responds with a redirect
 */
export function createFetchWithHeaders(
  baseFetch: typeof fetch | undefined,
  headers: RequestInit["headers"],
  origin: string,
): typeof fetch {
  const originalFetch = baseFetch || globalThis.fetch;
  return (async (url: URL | string | Request, init?: RequestInit) => {
    const target = new URL(url instanceof Request ? url.url : url);
    if (target.origin !== origin) return originalFetch(url, init);
    // Headers instances don't spread, so merge through the Headers API
    const merged = new Headers(headers);
    const set = (value: string, key: string) => merged.set(key, value);
    if (url instanceof Request) url.headers.forEach(set);
    new Headers(init?.headers).forEach(set);
    const response = await originalFetch(url, {
      ...init,
      headers: merged,
      redirect: "manual",
    });
    // Server runtimes expose the 3xx itself; browsers an opaque redirect (status 0)
    if (
      response.type === "opaqueredirect" ||
      [301, 302, 303, 307, 308].includes(response.status)
    ) {
      await response.body?.cancel();
      throw new Error(
        `MCP server redirected (HTTP ${response.status}); configured headers aren't sent across redirects: use the final URL`,
      );
    }
    return response;
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
      // Media types are case-insensitive
      const type = response.headers.get("content-type")?.toLowerCase();
      if (type?.startsWith("text/event-stream")) return response;
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
 * @throws TypeError/RangeError on an invalid endpoint or timeout, before any request;
 *   otherwise on a connection failure
 */
export async function connectMcp(
  endpoint: McpEndpoint,
  options: ConnectOptions = {},
): Promise<McpSession> {
  // Fail before any network, the same way for every transport
  const transport = endpoint.transport ?? "http";
  if (transport !== "http" && transport !== "sse") {
    throw new TypeError(`Unsupported transport: ${transport}`);
  }
  const url = URL.canParse(String(endpoint.url))
    ? new URL(endpoint.url)
    : undefined;
  if (url?.protocol !== "http:" && url?.protocol !== "https:") {
    // Not echoed: a URL may carry credentials
    throw new TypeError("MCP server URL must be an http: or https: URL");
  }
  const { timeout } = options;
  if (timeout !== undefined && !(timeout > 0 && timeout <= MAX_TIMEOUT)) {
    throw new RangeError(
      `timeout must be a positive number of milliseconds, at most ${MAX_TIMEOUT}`,
    );
  }

  const clientInfo = { name: "mcp-client-gen", version };

  // OAuth only where tokens can't leak (https: or loopback http:); elsewhere, e.g. a
  // private-network http: server, connect unauthenticated (endpoint headers still apply).
  const oauth = options.oauth ?? {};
  const auth =
    oauth !== false &&
    (url.protocol === "https:" || isLoopbackHost(url.hostname))
      ? browserAuth(
          // clientName and clientInformation are exclusive; default the name only for DCR
          oauth.clientInformation
            ? {
                ...oauth,
                serverUrl: url,
                redirectUri: oauth.redirectUri ?? oauthRedirectUri(),
              }
            : {
                ...oauth,
                serverUrl: url,
                redirectUri: oauth.redirectUri ?? oauthRedirectUri(),
                clientName: oauth.clientName ?? clientInfo.name,
              },
        )
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
    ...(transport === "http" && { versionNegotiation: { mode: "auto" } }),
  });

  try {
    const completeAuthorization =
      transport === "http"
        ? await connectHttp(
            client,
            auth,
            url,
            endpoint,
            options,
            requestOptions,
          )
        : await connectSse(
            client,
            auth,
            url,
            endpoint,
            options,
            requestOptions,
          );
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
  endpoint: McpEndpoint,
  options: ConnectOptions,
  requestOptions: RequestOptions,
): Promise<(() => Promise<void>) | undefined> {
  // Not `requestInit`: the SDK applies it to OAuth discovery and token requests too
  const signalled = options.signal
    ? createFetchWithSignal(options.fetch, options.signal)
    : options.fetch;
  const transportOptions = {
    fetch: endpoint.headers
      ? createFetchWithHeaders(signalled, endpoint.headers, url.origin)
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
  endpoint: McpEndpoint,
  options: ConnectOptions,
  requestOptions: RequestOptions,
): Promise<(() => Promise<void>) | undefined> {
  const baseFetch = endpoint.headers
    ? createFetchWithHeaders(options.fetch, endpoint.headers, url.origin)
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

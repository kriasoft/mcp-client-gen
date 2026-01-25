/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * Runtime MCP adapter - creates SDK clients, selects transport, wires OAuth.
 *
 * Contract: createMcpConnection(server, config?) → McpConnection
 * Invariant: Throws on connection failure; never exposes SDK internals.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import {
  StreamableHTTPClientTransport,
  type StreamableHTTPClientTransportOptions,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  Prompt,
  Resource,
  ServerCapabilities,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import {
  browserAuth,
  type BrowserAuthOptions,
  inMemoryStore,
} from "oauth-callback/mcp";
import type { McpServerConfig } from "./types.js";

export interface McpClientConfig {
  /** Client identifier sent to servers */
  name?: string;
  /** Client version for compatibility checks */
  version?: string;
  /** OAuth 2.1 auth settings */
  oauth?: Partial<BrowserAuthOptions>;
  /** Custom fetch for proxies/interceptors */
  fetch?: typeof fetch;
  /** Request timeout in ms (applies to HTTP transport) */
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
}

/**
 * Wrap fetch to inject headers for every request.
 */
function createFetchWithHeaders(
  baseFetch: typeof fetch | undefined,
  headers: Record<string, string>,
): typeof fetch {
  const originalFetch = baseFetch || globalThis.fetch;
  return ((url: URL | string, init?: RequestInit) =>
    originalFetch(url, {
      ...init,
      headers: { ...headers, ...init?.headers },
    })) as typeof fetch;
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
  const clientInfo = {
    name: config.name || "mcp-client-gen",
    version: config.version || "1.0.0",
  };

  // OAuth required for http/sse transports
  let authProvider: any | undefined;
  if (server.type === "http" || server.type === "sse") {
    const port = config.oauth?.port || 3000;

    authProvider = browserAuth({
      port,
      hostname: config.oauth?.hostname || "localhost",
      callbackPath: config.oauth?.callbackPath || "/callback",
      store: config.oauth?.store || inMemoryStore(),
      scope: config.oauth?.scope,
      clientId: config.oauth?.clientId,
      clientSecret: config.oauth?.clientSecret,
      launch: config.oauth?.launch,
      authTimeout: config.oauth?.authTimeout || 300000,
    });
  }

  // Transport factory - creates fresh transport for OAuth retry
  const createTransport = () => {
    if (server.type === "http") {
      const transportOptions: StreamableHTTPClientTransportOptions = {
        authProvider,
        fetch: config.fetch,
      };

      // Apply timeout and/or server headers via requestInit
      if (config.timeout || server.headers) {
        transportOptions.requestInit = {
          ...(config.timeout && {
            signal: AbortSignal.timeout(config.timeout),
          }),
          ...(server.headers && { headers: server.headers }),
        };
      }

      return new StreamableHTTPClientTransport(
        new URL(server.url),
        transportOptions,
      );
    } else if (server.type === "sse") {
      // SSE transport: wrap fetch to inject headers if needed
      const baseFetch = config.fetch;
      const fetchWithHeaders = server.headers
        ? createFetchWithHeaders(baseFetch, server.headers)
        : baseFetch;

      return new SSEClientTransport(new URL(server.url), {
        authProvider,
        fetch: fetchWithHeaders,
      });
    } else {
      throw new Error(`Unsupported server type: ${server.type}`);
    }
  };

  // Initialize client (server advertises its capabilities during handshake)
  const client = new Client(clientInfo, { capabilities: {} });

  // Connect with OAuth retry: after browser auth completes, tokens are saved but
  // SDK throws UnauthorizedError anyway. Retry with fresh transport succeeds.
  try {
    await client.connect(createTransport());
  } catch (error: unknown) {
    const isUnauthorized =
      error instanceof Error &&
      (error.constructor.name === "UnauthorizedError" ||
        error.message === "Unauthorized");

    if (isUnauthorized) {
      await client.connect(createTransport());
    } else {
      throw error;
    }
  }

  // Introspect: fetch tools/resources/prompts if server advertises support
  const capabilities = client.getServerCapabilities() ?? {};
  let tools: Tool[] = [];
  let resources: Resource[] = [];
  let prompts: Prompt[] = [];

  // Fetch advertised capabilities - if server advertises but listing fails, that's a connection error
  if (capabilities?.tools) {
    const result = await client.listTools();
    tools = result.tools;
  }

  if (capabilities?.resources) {
    const result = await client.listResources();
    resources = result.resources;
  }

  if (capabilities?.prompts) {
    const result = await client.listPrompts();
    prompts = result.prompts;
  }

  return {
    client,
    server,
    capabilities,
    tools,
    resources,
    prompts,
  };
}

/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StreamableHTTPClientTransport,
  type StreamableHTTPClientTransportOptions,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type {
  Tool,
  Resource,
  Prompt,
  ServerCapabilities,
} from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "./types.js";
import {
  browserAuth,
  type BrowserAuthOptions,
  inMemoryStore,
} from "oauth-callback/mcp";

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
  server: McpServer;
  capabilities?: ServerCapabilities;
  tools?: Tool[];
  resources?: Resource[];
  prompts?: Prompt[];
}

/**
 * Establish MCP connection with capability discovery.
 * @param server Server config (http/sse with URL)
 * @param config Client options (auth, timeout, etc)
 * @returns Connected client with introspected capabilities
 * @throws On unsupported server type or connection failure
 */
export async function createMcpConnection(
  server: McpServer,
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
      openBrowser: config.oauth?.openBrowser ?? true,
      authTimeout: config.oauth?.authTimeout || 300000,
      usePKCE: config.oauth?.usePKCE ?? true,
    });
  }

  // Transport factory: http (streaming), sse (event stream)
  let transport;
  if (server.type === "http") {
    const transportOptions: StreamableHTTPClientTransportOptions = {
      authProvider,
      fetch: config.fetch,
    };

    if (config.timeout) {
      transportOptions.requestInit = {
        signal: AbortSignal.timeout(config.timeout),
      };
    }

    transport = new StreamableHTTPClientTransport(
      new URL(server.url),
      transportOptions,
    );
  } else if (server.type === "sse") {
    transport = new SSEClientTransport(new URL(server.url), {
      authProvider,
      fetch: config.fetch,
    });
  } else {
    throw new Error(`Unsupported server type: ${server.type}`);
  }

  // Initialize client with empty capabilities (server provides actual)
  const client = new Client(clientInfo, {
    capabilities: {
      tools: {},
      prompts: {},
      resources: {},
    },
  });

  await client.connect(transport);

  // Introspect: fetch tools/resources/prompts if server advertises support
  const capabilities = client.getServerCapabilities();
  let tools: Tool[] = [];
  let resources: Resource[] = [];
  let prompts: Prompt[] = [];

  // Tools: callable functions with schemas
  if (capabilities?.tools) {
    try {
      const toolsResult = await client.listTools();
      tools = toolsResult.tools;
    } catch (error) {
      console.warn("Failed to list tools:", error);
    }
  }

  // Resources: readable URIs with metadata
  if (capabilities?.resources) {
    try {
      const resourcesResult = await client.listResources();
      resources = resourcesResult.resources;
    } catch (error) {
      console.warn("Failed to list resources:", error);
    }
  }

  // Prompts: templated interactions
  if (capabilities?.prompts) {
    try {
      const promptsResult = await client.listPrompts();
      prompts = promptsResult.prompts;
    } catch (error) {
      console.warn("Failed to list prompts:", error);
    }
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

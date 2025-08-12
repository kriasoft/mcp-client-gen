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
  CallToolResult,
  ReadResourceResult,
  GetPromptResult,
  ServerCapabilities,
} from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "./types.js";
import {
  McpOAuthProvider,
  type McpOAuthProviderOptions,
} from "./oauth-provider.js";

export interface McpClientConfig {
  /** Client name for identification */
  name?: string;
  /** Client version */
  version?: string;
  /** OAuth configuration */
  oauth?: Partial<McpOAuthProviderOptions>;
  /** Custom fetch implementation */
  fetch?: typeof fetch;
  /** Request timeout in milliseconds */
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
 * Creates an MCP client connection to a server
 *
 * @param server - MCP server configuration
 * @param config - Client configuration options
 * @returns Connected MCP client and metadata
 */
export async function createMcpConnection(
  server: McpServer,
  config: McpClientConfig = {},
): Promise<McpConnection> {
  const clientInfo = {
    name: config.name || "mcp-client-gen",
    version: config.version || "1.0.0",
  };

  // Create OAuth provider if needed
  let authProvider: McpOAuthProvider | undefined;
  if (server.type === "http" || server.type === "sse") {
    const redirectUrl =
      config.oauth?.redirectUrl || "http://localhost:3000/callback";

    authProvider = new McpOAuthProvider({
      redirectUrl,
      clientMetadata: config.oauth?.clientMetadata || {
        client_name: clientInfo.name,
        redirect_uris: [redirectUrl.toString()],
        scope: config.oauth?.clientMetadata?.scope,
      },
      storage: config.oauth?.storage,
      onRedirect: config.oauth?.onRedirect,
    });
  }

  // Create appropriate transport based on server type
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

  // Create and connect client
  const client = new Client(clientInfo, {
    capabilities: {
      tools: {},
      prompts: {},
      resources: {},
    },
  });

  await client.connect(transport);

  // Get server capabilities and available features
  const capabilities = client.getServerCapabilities();
  let tools: Tool[] = [];
  let resources: Resource[] = [];
  let prompts: Prompt[] = [];

  // List available tools if supported
  if (capabilities?.tools) {
    try {
      const toolsResult = await client.listTools();
      tools = toolsResult.tools;
    } catch (error) {
      console.warn("Failed to list tools:", error);
    }
  }

  // List available resources if supported
  if (capabilities?.resources) {
    try {
      const resourcesResult = await client.listResources();
      resources = resourcesResult.resources;
    } catch (error) {
      console.warn("Failed to list resources:", error);
    }
  }

  // List available prompts if supported
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

/**
 * MCP Client Manager for managing multiple server connections
 */
export class McpClientManager {
  private connections = new Map<string, McpConnection>();
  private config: McpClientConfig;

  constructor(config: McpClientConfig = {}) {
    this.config = config;
  }

  /**
   * Connect to a server and add it to managed connections
   */
  async addServer(server: McpServer): Promise<McpConnection> {
    const connectionKey = `${server.type}:${server.url}`;

    // Return existing connection if available
    const existing = this.connections.get(connectionKey);
    if (existing) {
      return existing;
    }

    // Create new connection
    const connection = await createMcpConnection(server, this.config);
    this.connections.set(connectionKey, connection);
    return connection;
  }

  /**
   * Get connection for a specific server
   */
  getConnection(serverUrl: string): McpConnection | undefined {
    for (const connection of this.connections.values()) {
      if (connection.server.url === serverUrl) {
        return connection;
      }
    }
    return undefined;
  }

  /**
   * Get all managed connections
   */
  getAllConnections(): McpConnection[] {
    return Array.from(this.connections.values());
  }

  /**
   * Call a tool on a specific server
   */
  async callTool(
    serverUrl: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> {
    const connection = this.getConnection(serverUrl);
    if (!connection) {
      throw new Error(`No connection found for server: ${serverUrl}`);
    }

    // Verify tool exists
    const tool = connection.tools?.find((t) => t.name === toolName);
    if (!tool) {
      throw new Error(`Tool '${toolName}' not found on server ${serverUrl}`);
    }

    return await connection.client.callTool({
      name: toolName,
      arguments: args,
    });
  }

  /**
   * Read a resource from a specific server
   */
  async readResource(
    serverUrl: string,
    uri: string,
  ): Promise<ReadResourceResult> {
    const connection = this.getConnection(serverUrl);
    if (!connection) {
      throw new Error(`No connection found for server: ${serverUrl}`);
    }

    return await connection.client.readResource({ uri });
  }

  /**
   * Get a prompt from a specific server
   */
  async getPrompt(
    serverUrl: string,
    name: string,
    args?: Record<string, string>,
  ): Promise<GetPromptResult> {
    const connection = this.getConnection(serverUrl);
    if (!connection) {
      throw new Error(`No connection found for server: ${serverUrl}`);
    }

    return await connection.client.getPrompt({
      name,
      arguments: args,
    });
  }

  /**
   * Get all available tools across all connections
   */
  getAllTools(): Array<{ server: McpServer; tools: Tool[] }> {
    return Array.from(this.connections.values()).map((conn) => ({
      server: conn.server,
      tools: conn.tools || [],
    }));
  }

  /**
   * Disconnect from a specific server
   */
  async disconnect(serverUrl: string): Promise<void> {
    for (const [key, connection] of this.connections) {
      if (connection.server.url === serverUrl) {
        await connection.client.close();
        this.connections.delete(key);
        return;
      }
    }
  }

  /**
   * Disconnect from all servers
   */
  async disconnectAll(): Promise<void> {
    const promises = Array.from(this.connections.values()).map((conn) =>
      conn.client.close(),
    );
    await Promise.allSettled(promises);
    this.connections.clear();
  }
}

/**
 * Convenience function to create a client manager with multiple servers
 */
export async function createMcpClientManager(
  servers: McpServer[],
  config: McpClientConfig = {},
): Promise<McpClientManager> {
  const manager = new McpClientManager(config);

  // Connect to all servers in parallel
  const promises = servers.map((server) => manager.addServer(server));
  await Promise.allSettled(promises);

  return manager;
}

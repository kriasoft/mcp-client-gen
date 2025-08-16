/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import type {
  Tool,
  Resource,
  Prompt,
  ServerCapabilities,
} from "@modelcontextprotocol/sdk/types.js";
import {
  createMcpConnection,
  type McpClientConfig,
  type McpConnection,
} from "./mcp-client.js";
import type { McpServer } from "./types.js";

export interface IntrospectionResult {
  server: McpServer;
  capabilities?: ServerCapabilities;
  tools: Tool[];
  resources: Resource[];
  prompts: Prompt[];
  error?: string;
}

/**
 * Introspect a single MCP server to discover its capabilities.
 * @param server MCP server configuration
 * @param config Optional client configuration
 * @returns Server capabilities or error
 */
export async function introspectServer(
  server: McpServer,
  config?: McpClientConfig,
): Promise<IntrospectionResult> {
  let connection: McpConnection | undefined;

  try {
    connection = await createMcpConnection(server, config);

    return {
      server,
      capabilities: connection.capabilities,
      tools: connection.tools || [],
      resources: connection.resources || [],
      prompts: connection.prompts || [],
    };
  } catch (error) {
    return {
      server,
      tools: [],
      resources: [],
      prompts: [],
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (connection?.client) {
      try {
        await connection.client.close();
      } catch {
        // Ignore disconnect errors
      }
    }
  }
}

/**
 * Introspect multiple MCP servers in parallel.
 * @param servers Array of server configurations
 * @param config Optional client configuration
 * @returns Array of introspection results (preserves input order)
 */
export async function introspectServersParallel(
  servers: McpServer[],
  config?: McpClientConfig,
): Promise<IntrospectionResult[]> {
  const promises = servers.map((server) => introspectServer(server, config));
  return Promise.all(promises);
}

/**
 * Cache for server capabilities to avoid repeated introspection.
 * Key format: `${server.type}:${server.url}`
 */
const capabilityCache = new Map<string, IntrospectionResult>();

/**
 * Get cached server capabilities or introspect if not cached.
 * @param server MCP server configuration
 * @param config Optional client configuration
 * @param forceRefresh Skip cache and force fresh introspection
 * @returns Server capabilities
 */
export async function getCachedCapabilities(
  server: McpServer,
  config?: McpClientConfig,
  forceRefresh = false,
): Promise<IntrospectionResult> {
  const cacheKey = `${server.type}:${server.url}`;

  if (!forceRefresh) {
    const cached = capabilityCache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const result = await introspectServer(server, config);
  if (!result.error) {
    capabilityCache.set(cacheKey, result);
  }

  return result;
}

/**
 * Clear the capability cache.
 */
export function clearCapabilityCache(): void {
  capabilityCache.clear();
}

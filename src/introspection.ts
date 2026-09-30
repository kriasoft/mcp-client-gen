/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * Capability discovery - fetches tools/resources/prompts from MCP servers.
 *
 * Contract: introspectServer(server) → IntrospectionResult
 * Invariant: Never throws for per-server failures; returns discriminated union.
 */

import type {
  Prompt,
  Resource,
  ServerCapabilities,
  Tool,
} from "@modelcontextprotocol/client";
import {
  createMcpConnection,
  type McpClientConfig,
  type McpConnection,
} from "./mcp-client.js";
import type { McpServerConfig } from "./types.js";

/**
 * Successful introspection result with discovered capabilities.
 */
export interface IntrospectionSuccess {
  ok: true;
  server: McpServerConfig;
  /** Server-advertised capabilities (empty object if none advertised) */
  capabilities: ServerCapabilities;
  tools: Tool[];
  resources: Resource[];
  prompts: Prompt[];
}

/**
 * Failed introspection result with error message.
 */
export interface IntrospectionFailure {
  ok: false;
  server: McpServerConfig;
  error: string;
}

/**
 * Result of introspecting an MCP server.
 * Discriminated union: check `ok` to narrow the type.
 */
export type IntrospectionResult = IntrospectionSuccess | IntrospectionFailure;

/**
 * Introspect a single MCP server to discover its capabilities.
 * @param server MCP server configuration
 * @param config Optional client configuration
 * @returns Server capabilities or error
 */
export async function introspectServer(
  server: McpServerConfig,
  config?: McpClientConfig,
): Promise<IntrospectionResult> {
  let connection: McpConnection | undefined;

  try {
    connection = await createMcpConnection(server, config);

    return {
      ok: true,
      server,
      capabilities: connection.capabilities,
      tools: connection.tools,
      resources: connection.resources,
      prompts: connection.prompts,
    };
  } catch (error) {
    return {
      ok: false,
      server,
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
export async function introspectServers(
  servers: McpServerConfig[],
  config?: McpClientConfig,
): Promise<IntrospectionResult[]> {
  const promises = servers.map((server) => introspectServer(server, config));
  return Promise.all(promises);
}

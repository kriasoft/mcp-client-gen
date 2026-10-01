/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * Capability discovery - snapshots a server's tools/resources/prompts for codegen.
 *
 * Contract: introspectServer(server, config?) → Introspection
 * Invariant: Always closes its connection. Errors propagate unchanged (SDK error types
 * and causes intact); callers label them.
 */

import type {
  Prompt,
  Resource,
  ServerCapabilities,
  Tool,
} from "@modelcontextprotocol/client";
import { createMcpConnection, type McpClientConfig } from "./mcp-client.js";
import type { McpServerConfig } from "./types.js";

/** What a server advertises: everything codegen needs. */
export interface Introspection {
  /** Server-advertised capabilities (empty object if none advertised) */
  capabilities: ServerCapabilities;
  tools: Tool[];
  resources: Resource[];
  prompts: Prompt[];
  /** Whether requests carried OAuth tokens (callers likely need OAuth too) */
  authorized: boolean;
}

/** Connect, list capabilities, disconnect. */
export async function introspectServer(
  server: McpServerConfig,
  config?: McpClientConfig,
): Promise<Introspection> {
  const { client, ...introspection } = await createMcpConnection(
    server,
    config,
  );
  await client.close().catch(() => {}); // the snapshot is complete
  return introspection;
}

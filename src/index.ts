/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * Public API: generate a typed client module for an MCP server. Generated code needs
 * only `@modelcontextprotocol/client` at runtime and type-check time (ADR-003).
 */

export { generateClient, type GenerateClientOptions } from "./pipeline.js";
export type { McpOAuthOptions } from "./mcp-client.js";
export type { McpServerConfig } from "./types.js";

/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * Public API: generate a typed client module for an MCP server. Generated code needs
 * only `@modelcontextprotocol/client` at runtime and type-check time (ADR-003).
 */

export { generateClient } from "./pipeline.js";
export type {
  GenerateClientOptions,
  McpOAuthOptions,
  McpServerConfig,
} from "./types.js";

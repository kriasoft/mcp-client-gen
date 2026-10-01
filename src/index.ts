/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * Public API (SPEC-api): generate a typed client module for an MCP server. Generated code
 * needs only `@modelcontextprotocol/client` at runtime and type-check time (ADR-003).
 */

export type { McpEndpoint } from "./connect.js";
export {
  generateClientModule,
  type GenerateClientOptions,
} from "./pipeline.js";

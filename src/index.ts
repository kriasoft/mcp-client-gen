/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * Public API - stable exports for library consumers.
 * For advanced/internal APIs, import from "mcp-client-gen/internal".
 */

export {
  formatTypeScript,
  generateClient,
  writeGeneratedClient,
} from "./pipeline.js";

export { createMcpConnection } from "./mcp-client.js";

export {
  findMcpConfigFiles,
  formatConfigWarning,
  getMcpServers,
  resolveConfigFiles,
  type ResolveConfigOptions,
} from "./config.js";

// OAuth credential persistence for McpClientConfig.oauth.store (from oauth-callback)
export { fileStore, type CredentialStore } from "oauth-callback/mcp";

// Types
export type {
  Prompt,
  Resource,
  ServerCapabilities,
  Tool,
} from "@modelcontextprotocol/client";
export type {
  IntrospectionFailure,
  IntrospectionResult,
  IntrospectionSuccess,
} from "./introspection.js";
export type {
  McpClientConfig,
  McpConnection,
  McpOAuthOptions,
} from "./mcp-client.js";
export type { GenerationOptions, GenerationResult } from "./pipeline.js";
export type {
  ConfigWarning,
  McpServerConfig,
  ParseServersResult,
} from "./types.js";

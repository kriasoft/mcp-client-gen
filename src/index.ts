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

// OAuth (re-exported from oauth-callback)
export {
  browserAuth,
  fileStore,
  inMemoryStore,
  type BrowserAuthOptions,
  type ClientInfo,
  type OAuthStore,
  type Tokens,
  type TokenStore,
} from "oauth-callback/mcp";

// Types
export type {
  Prompt,
  Resource,
  ServerCapabilities,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
export type {
  IntrospectionFailure,
  IntrospectionResult,
  IntrospectionSuccess,
} from "./introspection.js";
export type { McpClientConfig, McpConnection } from "./mcp-client.js";
export type { GenerationOptions, GenerationResult } from "./pipeline.js";
export type {
  ConfigWarning,
  McpServerConfig,
  ParseServersResult,
} from "./types.js";

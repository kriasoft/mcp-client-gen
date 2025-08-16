/**
 * Public API exports for MCP Client Generator library.
 * Tree-shakable modules for optimal bundle size.
 *
 * SPDX-FileCopyrightText: 2025-present Kriasoft
 * SPDX-License-Identifier: MIT
 */

export {
  findMcpConfigFiles,
  getMcpServers,
  MCP_CONFIG_PATHS,
} from "./config.js";
export { createMcpConnection } from "./mcp-client.js";

// Re-export browserAuth and related types from oauth-callback/mcp
export {
  browserAuth,
  type BrowserAuthOptions,
  type TokenStore,
  type OAuthStore,
  type Tokens,
  type ClientInfo,
  type OAuthSession,
  inMemoryStore,
  fileStore,
} from "oauth-callback/mcp";
export {
  introspectServer,
  introspectServersParallel,
  getCachedCapabilities,
  clearCapabilityCache,
} from "./introspection.js";
export {
  jsonSchemaToTypeScript,
  generateToolInterface,
  generateClientClass,
  generateClientFile,
} from "./codegen/index.js";
export {
  SchemaTransformer,
  schemaTransformer,
  SchemaValidator,
  schemaValidator,
} from "./schema.js";

export type { McpServer } from "./types.js";

export type { McpClientConfig, McpConnection } from "./mcp-client.js";

export type { IntrospectionResult } from "./introspection.js";

export type { CodegenOptions } from "./codegen/index.js";

// Re-export MCP SDK types
export type {
  Tool,
  Resource,
  Prompt,
  ServerCapabilities,
} from "@modelcontextprotocol/sdk/types.js";

export type {
  JsonSchemaType,
  TypeScriptType,
  ValidatedTool,
} from "./schema.js";

export type { PromptsResult } from "./prompts.js";

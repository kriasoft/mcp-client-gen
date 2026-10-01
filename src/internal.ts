/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * Internal APIs for custom pipelines and advanced use cases.
 * These exports are not covered by semver guarantees.
 *
 * @example
 * import { introspectServer, jsonSchemaToTypeScript } from "mcp-client-gen/internal";
 */

export { introspectServer, introspectServers } from "./introspection.js";

export {
  generateServerClient,
  generateClientFile,
  generateToolInputType,
  generateToolOutputType,
  hasOutputSchema,
  jsonSchemaToTypeScript,
  type CodegenResult,
} from "./codegen/index.js";

export { MCP_CONFIG_PATHS } from "./config.js";

export { extractServerName } from "./pipeline.js";

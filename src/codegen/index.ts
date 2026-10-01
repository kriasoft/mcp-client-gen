/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * Codegen module - transforms introspected data into TypeScript code.
 *
 * Contract: generateClientFile(servers) → CodegenResult { code, exports }
 * Owns: AST generation, naming rules, export structure. Does not own: MCP protocol.
 */

// Re-export all public APIs
export { clientTypeName, generateServerClient } from "./client-generator.js";
export { generateClientFile, type CodegenResult } from "./file-builder.js";
export { jsonSchemaToTypeScript } from "./schema-to-typescript.js";
export {
  generateToolInputType,
  generateToolOutputType,
  hasOutputSchema,
} from "./tool-input-generator.js";
export { camelCase, pascalCase } from "./utils.js";

/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * Codegen module - transforms introspected data into TypeScript code.
 *
 * Contract: generateClientFile(servers, options?) → CodegenResult { code, exports }
 * Owns: AST generation, naming rules, export structure. Does not own: MCP protocol.
 */

// Re-export all public APIs
export { generateClientClass } from "./class-generator.js";
export {
  generateClientFile,
  type CodegenOptions,
  type CodegenResult,
} from "./file-builder.js";
export { jsonSchemaToTypeScript } from "./schema-to-typescript.js";
export {
  generateToolInterface,
  generateToolOutputInterface,
  hasOutputSchema,
} from "./tool-input-generator.js";
export { camelCase, pascalCase } from "./utils.js";

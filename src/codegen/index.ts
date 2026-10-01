/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * Codegen module - transforms introspected data into TypeScript code.
 *
 * Contract: generateClientFile(serverName, introspection) → code
 * Owns: AST generation, naming rules, export structure. Does not own: MCP protocol.
 */

export { clientTypeName } from "./client-generator.js";
export { generateClientFile } from "./file-builder.js";
export {
  jsonSchemaToTypeScript,
  schemaTypeAliases,
} from "./schema-to-typescript.js";
export { camelCase, pascalCase } from "./utils.js";

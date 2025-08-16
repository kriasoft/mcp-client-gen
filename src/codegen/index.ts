/**
 * Code generation module for MCP client TypeScript files.
 *
 * Use examples/notion.ts as a template/reference for the generated client structure:
 * - Type-safe interfaces for tool inputs/outputs
 * - Client class with connection management
 * - Error handling with handleToolResult utility
 * - Async connection lifecycle (ensureConnected pattern)
 * - Resource disposal with Symbol.asyncDispose
 *
 * SPDX-FileCopyrightText: 2025-present Kriasoft
 * SPDX-License-Identifier: MIT
 */

// Re-export all public APIs
export { generateClientClass } from "./class-generator.js";
export { generateClientFile, type CodegenOptions } from "./file-builder.js";
export { generateToolInterface } from "./interface-generator.js";
export { jsonSchemaToTypeScript } from "./schema-converter.js";
export { camelCase, pascalCase } from "./utils.js";

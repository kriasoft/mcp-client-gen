/**
 * Tool input/output type generation.
 *
 * Emits type aliases (not interfaces) from the whole schema: roots may be unions or
 * dictionaries, and only aliases are assignable to the SDK's Record<string, unknown>
 * tool arguments.
 *
 * SPDX-FileCopyrightText: 2025-present Kriasoft
 * SPDX-License-Identifier: MIT
 */

import type { Tool } from "@modelcontextprotocol/client";
import type { SourceFile, TypeAliasDeclaration } from "ts-morph";
import { jsonSchemaToTypeScript } from "./schema-to-typescript.js";
import { commentText } from "./utils.js";

/** Emit `export type {name} = …` for a tool's input schema. */
export function generateToolInputType(
  sourceFile: SourceFile,
  tool: Tool,
  name: string,
): TypeAliasDeclaration {
  const type = jsonSchemaToTypeScript(tool.inputSchema);
  return sourceFile.addTypeAlias({
    name,
    isExported: true,
    // Tool arguments are always an object, even when the schema can't say which
    type: type === "unknown" ? "Record<string, unknown>" : type,
    docs: tool.description ? [commentText(tool.description)] : [],
  });
}

/** Emit `export type {name} = …` for a tool's output schema, if it declares one. */
export function generateToolOutputType(
  sourceFile: SourceFile,
  tool: Tool,
  name: string,
): TypeAliasDeclaration | undefined {
  if (!hasOutputSchema(tool)) return undefined;
  return sourceFile.addTypeAlias({
    name,
    isExported: true,
    type: jsonSchemaToTypeScript(tool.outputSchema),
    docs: [commentText(`Structured result of the \`${tool.name}\` tool.`)],
  });
}

/** Whether a tool declares an outputSchema (its result is typed structuredContent). */
export function hasOutputSchema(tool: Tool): boolean {
  return tool.outputSchema !== undefined;
}

/** Whether the tool can be called without arguments (no required input). */
export function hasOptionalInput(tool: Tool): boolean {
  const schema = tool.inputSchema as Record<string, unknown>;
  const required = schema.required;
  return (
    !(Array.isArray(required) && required.length > 0) &&
    !schema.anyOf &&
    !schema.oneOf &&
    !schema.allOf &&
    !schema.$ref
  );
}

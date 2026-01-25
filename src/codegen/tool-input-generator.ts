/**
 * TypeScript interface generation from MCP tool definitions.
 *
 * Generates strongly-typed interfaces for tool inputs and outputs
 * with proper JSDoc comments and property definitions.
 *
 * SPDX-FileCopyrightText: 2025-present Kriasoft
 * SPDX-License-Identifier: MIT
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { InterfaceDeclaration, SourceFile } from "ts-morph";
import { jsonSchemaToTypeScript } from "./schema-to-typescript.js";
import { pascalCase } from "./utils.js";

/**
 * Generate TypeScript interface from a tool definition
 */
export function generateToolInterface(
  sourceFile: SourceFile,
  tool: Tool,
): InterfaceDeclaration {
  const interfaceName = pascalCase(tool.name) + "Input";

  // Parse the input schema to TypeScript
  const typeString = jsonSchemaToTypeScript(tool.inputSchema);

  // Create interface with parsed properties
  const interfaceDecl = sourceFile.addInterface({
    name: interfaceName,
    isExported: true,
  });

  if (tool.description) {
    interfaceDecl.addJsDoc({
      description: tool.description,
    });
  }

  // MCP spec guarantees inputSchema.type === "object"
  if (tool.inputSchema?.properties) {
    const required = new Set(tool.inputSchema.required || []);

    for (const [key, propSchema] of Object.entries(
      tool.inputSchema.properties,
    )) {
      const prop = interfaceDecl.addProperty({
        name: key,
        type: jsonSchemaToTypeScript(propSchema),
        hasQuestionToken: !required.has(key),
      });

      // Add JSDoc if description exists
      if ((propSchema as any).description) {
        prop.addJsDoc({
          description: (propSchema as any).description,
        });
      }
    }
  }

  return interfaceDecl;
}

/**
 * Generate TypeScript interface from a tool's outputSchema (if present).
 * Returns undefined if the tool has no outputSchema.
 */
export function generateToolOutputInterface(
  sourceFile: SourceFile,
  tool: Tool,
): InterfaceDeclaration | undefined {
  const outputSchema = (tool as any).outputSchema;
  if (!outputSchema) return undefined;

  const interfaceName = pascalCase(tool.name) + "Output";

  const interfaceDecl = sourceFile.addInterface({
    name: interfaceName,
    isExported: true,
  });

  interfaceDecl.addJsDoc({
    description: `Output type for ${tool.name}`,
  });

  // MCP spec: outputSchema follows same structure as inputSchema (object)
  if (outputSchema.properties) {
    const required = new Set(outputSchema.required || []);

    for (const [key, propSchema] of Object.entries(outputSchema.properties)) {
      const prop = interfaceDecl.addProperty({
        name: key,
        type: jsonSchemaToTypeScript(propSchema),
        hasQuestionToken: !required.has(key),
      });

      if ((propSchema as any).description) {
        prop.addJsDoc({
          description: (propSchema as any).description,
        });
      }
    }
  }

  return interfaceDecl;
}

/**
 * Check if a tool has an outputSchema defined.
 */
export function hasOutputSchema(tool: Tool): boolean {
  return !!(tool as any).outputSchema;
}

/**
 * TypeScript interface generation from MCP tool definitions.
 *
 * Generates strongly-typed interfaces for tool inputs with proper
 * JSDoc comments and property definitions.
 *
 * SPDX-FileCopyrightText: 2025-present Kriasoft
 * SPDX-License-Identifier: MIT
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { InterfaceDeclaration, SourceFile } from "ts-morph";
import { jsonSchemaToTypeScript } from "./schema-converter.js";
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

  // If we have object properties, add them individually
  if (tool.inputSchema?.type === "object" && tool.inputSchema.properties) {
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
  } else if (typeString !== "{}") {
    // For non-object types, create a wrapper interface
    interfaceDecl.addProperty({
      name: "value",
      type: typeString,
    });
  }

  return interfaceDecl;
}

/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * File builder - assembles complete TS file from interfaces and classes.
 *
 * Coordinates imports, utility functions, generated types, and factory exports.
 */

import { Project, ts } from "ts-morph";
import type { IntrospectionSuccess } from "../introspection.js";
import { generateClientClass } from "./class-generator.js";
import {
  generateToolInterface,
  generateToolOutputInterface,
} from "./tool-input-generator.js";
import { pascalCase } from "./utils.js";

/**
 * Options for code generation
 */
export interface CodegenOptions {
  /** Client class name prefix */
  clientPrefix?: string;
  /** Include JSDoc comments */
  includeComments?: boolean;
  /** Generate tree-shakable exports */
  treeShakable?: boolean;
}

/**
 * Result from code generation including usage metadata.
 */
export interface CodegenResult {
  /** Generated TypeScript source code */
  code: string;
  /** Exported factory function names (source of truth for CLI) */
  exports: string[];
}

/**
 * Generate complete TypeScript client file from successful introspections.
 * Returns code and export metadata for CLI usage instructions.
 */
export function generateClientFile(
  servers: Map<string, IntrospectionSuccess>,
  options: CodegenOptions = {},
): CodegenResult {
  const exports: string[] = [];
  const project = new Project({
    useInMemoryFileSystem: true,
  });

  const sourceFile = project.createSourceFile("mcp-client.ts", "", {
    overwrite: true,
  });

  // Add file header
  sourceFile.addStatements([
    `/* Generated MCP Client SDK */`,
    options.treeShakable !== false
      ? `/* Import individual createXClient() functions for optimal tree-shaking */`
      : ``,
    ``,
  ]);

  // Add imports (type-only: generated code has no runtime SDK dependency)
  sourceFile.addImportDeclaration({
    moduleSpecifier: "@modelcontextprotocol/client",
    namedImports: [
      "BlobResourceContents",
      "Client",
      "PromptMessage",
      "TextResourceContents",
    ],
    isTypeOnly: true,
  });

  sourceFile.addImportDeclaration({
    moduleSpecifier: "mcp-client-gen",
    namedImports: ["McpConnection"],
    isTypeOnly: true,
  });

  sourceFile.addStatements([``]);

  // Embed utility functions directly in the generated code
  addUtilityFunctions(sourceFile);

  // Generate interfaces and classes for each server
  for (const [serverName, result] of servers) {
    // Generate tool input interfaces
    for (const tool of result.tools) {
      if (tool.inputSchema) {
        generateToolInterface(sourceFile, tool);
      }
    }

    // Generate tool output interfaces (when outputSchema is present)
    for (const tool of result.tools) {
      generateToolOutputInterface(sourceFile, tool);
    }

    // Generate client class
    const classDecl = generateClientClass(sourceFile, serverName, result);

    // Add factory function for convenience
    if (options.treeShakable !== false) {
      sourceFile.addStatements([``]);

      const factoryName = `create${pascalCase(serverName)}Client`;
      exports.push(factoryName);

      sourceFile.addFunction({
        name: factoryName,
        isExported: true,
        parameters: [
          {
            name: "connection",
            type: "McpConnection",
          },
        ],
        returnType: classDecl.getName()!,
        statements: [`return new ${classDecl.getName()}(connection);`],
      });
    }
  }

  // Format and return
  sourceFile.formatText({
    indentSize: 2,
    semicolons: ts.SemicolonPreference.Insert,
  });

  return { code: sourceFile.getFullText(), exports };
}

/**
 * Add utility functions to the source file
 */
function addUtilityFunctions(sourceFile: any): void {
  sourceFile.addStatements([
    `/**`,
    ` * Helper function to handle MCP tool call results with proper error checking`,
    ` * @param result - The result from client.callTool()`,
    ` * @param toolName - Name of the tool for error messages`,
    ` * @returns The first content item from the result`,
    ` * @throws Error if the tool returned an error or invalid content`,
    ` */`,
    `function handleToolResult<T = any>(result: any, toolName: string): T {`,
    `  // Check if the tool returned an error`,
    `  if (result.isError) {`,
    `    const errorContent = result.content?.[0];`,
    `    const errorMessage =`,
    `      errorContent && typeof errorContent === "object" && "text" in errorContent`,
    `        ? String(errorContent.text)`,
    `        : "Tool execution failed";`,
    `    throw new Error(\`Tool '\${toolName}' error: \${errorMessage}\`);`,
    `  }`,
    ``,
    `  // Validate content exists and is non-empty`,
    `  if (`,
    `    !result.content ||`,
    `    !Array.isArray(result.content) ||`,
    `    result.content.length === 0`,
    `  ) {`,
    `    throw new Error(\`Tool '\${toolName}' returned empty content\`);`,
    `  }`,
    ``,
    `  // Extract the first content item`,
    `  const content = result.content[0];`,
    `  if (!content || typeof content !== "object") {`,
    `    throw new Error(\`Tool '\${toolName}' returned invalid content structure\`);`,
    `  }`,
    ``,
    `  return content as T;`,
    `}`,
    ``,
    `/**`,
    ` * Helper function to handle MCP resource read results`,
    ` * @param result - The result from client.readResource()`,
    ` * @param resourceUri - URI of the resource for error messages`,
    ` * @returns The first content item from the result`,
    ` * @throws Error if the resource returned empty contents`,
    ` */`,
    `function handleResourceResult(`,
    `  result: any,`,
    `  resourceUri: string,`,
    `): TextResourceContents | BlobResourceContents {`,
    `  // Validate contents exist`,
    `  if (`,
    `    !result.contents ||`,
    `    !Array.isArray(result.contents) ||`,
    `    result.contents.length === 0`,
    `  ) {`,
    `    throw new Error(\`Resource '\${resourceUri}' returned empty contents\`);`,
    `  }`,
    ``,
    `  return result.contents[0];`,
    `}`,
    ``,
  ]);
}

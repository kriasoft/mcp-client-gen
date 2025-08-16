/**
 * TypeScript file builder for MCP client generation.
 *
 * Assembles the complete TypeScript file with imports, utility functions,
 * interfaces, classes, and singleton instances.
 *
 * SPDX-FileCopyrightText: 2025-present Kriasoft
 * SPDX-License-Identifier: MIT
 */

import { Project, ts } from "ts-morph";
import type { IntrospectionResult } from "../introspection.js";
import { generateClientClass } from "./class-generator.js";
import { generateToolInterface } from "./interface-generator.js";
import { camelCase, pascalCase } from "./utils.js";

/**
 * Options for code generation
 */
export interface CodegenOptions {
  /** Output file path */
  outputPath?: string;
  /** Client class name prefix */
  clientPrefix?: string;
  /** Include JSDoc comments */
  includeComments?: boolean;
  /** Generate tree-shakable exports */
  treeShakable?: boolean;
}

/**
 * Generate complete TypeScript client file
 */
export function generateClientFile(
  servers: Map<string, IntrospectionResult>,
  options: CodegenOptions = {},
): string {
  const project = new Project({
    useInMemoryFileSystem: true,
  });

  const sourceFile = project.createSourceFile(
    options.outputPath || "mcp-client.ts",
    "",
    { overwrite: true },
  );

  // Add file header
  sourceFile.addStatements([
    `/* Generated MCP Client SDK */`,
    `/* Generated at: ${new Date().toISOString()} */`,
    ``,
  ]);

  // Add imports
  sourceFile.addImportDeclaration({
    moduleSpecifier: "@modelcontextprotocol/sdk/client/index.js",
    namedImports: ["Client"],
  });

  sourceFile.addImportDeclaration({
    moduleSpecifier: "./types.js",
    namedImports: ["McpConnection"],
    isTypeOnly: true,
  });

  sourceFile.addStatements([``]);

  // Embed utility functions directly in the generated code
  addUtilityFunctions(sourceFile);

  // Generate interfaces and classes for each server
  const clientInstances: string[] = [];

  for (const [serverName, result] of servers) {
    if (result.error) {
      sourceFile.addStatements([
        `// Error introspecting ${serverName}: ${result.error}`,
        ``,
      ]);
      continue;
    }

    // Generate tool interfaces
    for (const tool of result.tools) {
      if (tool.inputSchema) {
        generateToolInterface(sourceFile, tool);
      }
    }

    // Generate client class
    const classDecl = generateClientClass(sourceFile, serverName, result);

    // Create singleton instance if tree-shakable
    if (options.treeShakable !== false) {
      const instanceName = camelCase(serverName);
      clientInstances.push(instanceName);

      sourceFile.addStatements([
        ``,
        `// Singleton instance for ${serverName}`,
        `let _${instanceName}: ${classDecl.getName()} | undefined;`,
        ``,
      ]);

      sourceFile.addFunction({
        name: `get${pascalCase(serverName)}Client`,
        isExported: true,
        parameters: [
          {
            name: "connection",
            type: "McpConnection",
          },
        ],
        returnType: classDecl.getName()!,
        statements: [
          `if (!_${instanceName}) {`,
          `  _${instanceName} = new ${classDecl.getName()}(connection);`,
          `}`,
          `return _${instanceName};`,
        ],
      });
    }
  }

  // Format and return
  sourceFile.formatText({
    indentSize: 2,
    semicolons: ts.SemicolonPreference.Insert,
  });

  return sourceFile.getFullText();
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
    `function handleResourceResult<T = any>(`,
    `  result: any,`,
    `  resourceUri: string,`,
    `): T {`,
    `  // Validate contents exist`,
    `  if (`,
    `    !result.contents ||`,
    `    !Array.isArray(result.contents) ||`,
    `    result.contents.length === 0`,
    `  ) {`,
    `    throw new Error(\`Resource '\${resourceUri}' returned empty contents\`);`,
    `  }`,
    ``,
    `  return result.contents[0] as T;`,
    `}`,
    ``,
  ]);
}

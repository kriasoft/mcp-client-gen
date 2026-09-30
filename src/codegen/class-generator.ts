/**
 * MCP client class generation.
 *
 * Generates TypeScript classes with methods for tools, resources, and prompts.
 * Handles method generation, parameter mapping, and return type definitions.
 *
 * SPDX-FileCopyrightText: 2025-present Kriasoft
 * SPDX-License-Identifier: MIT
 */

import type { Prompt, Resource, Tool } from "@modelcontextprotocol/client";
import {
  type ClassDeclaration,
  type MethodDeclaration,
  Scope,
  type SourceFile,
} from "ts-morph";
import type { IntrospectionSuccess } from "../introspection.js";
import { hasOutputSchema } from "./tool-input-generator.js";
import { camelCase, pascalCase } from "./utils.js";

// Return type names from MCP SDK (imported by file-builder.ts)
const RESOURCE_CONTENT_TYPE = "TextResourceContents | BlobResourceContents";
const PROMPT_MESSAGE_TYPE = "PromptMessage[]";

/**
 * Generate client class for an MCP server
 */
export function generateClientClass(
  sourceFile: SourceFile,
  serverName: string,
  result: IntrospectionSuccess,
): ClassDeclaration {
  const className = pascalCase(serverName) + "Client";

  const classDecl = sourceFile.addClass({
    name: className,
    isExported: true,
  });

  // Add JSDoc
  classDecl.addJsDoc({
    description: `MCP client for ${serverName} server`,
  });

  // Add private connection property
  classDecl.addProperty({
    name: "connection",
    type: "McpConnection",
    scope: Scope.Private,
  });

  // Add constructor
  classDecl.addConstructor({
    parameters: [
      {
        name: "connection",
        type: "McpConnection",
      },
    ],
    statements: ["this.connection = connection;"],
  });

  // Add client getter for advanced operations (streaming, etc.)
  const clientGetter = classDecl.addGetAccessor({
    name: "client",
    returnType: "Client",
  });
  clientGetter.addJsDoc({
    description:
      "Access underlying MCP client for advanced operations (streaming, raw requests)",
  });
  clientGetter.addStatements(["return this.connection.client;"]);

  // Generate methods for each tool
  for (const tool of result.tools) {
    generateToolMethod(classDecl, tool);
  }

  // Generate methods for resources
  if (result.resources.length > 0) {
    generateResourceMethods(classDecl, result.resources);
  }

  // Generate methods for prompts
  if (result.prompts.length > 0) {
    generatePromptMethods(classDecl, result.prompts);
  }

  return classDecl;
}

/**
 * Generate a method for a tool
 */
function generateToolMethod(
  classDecl: ClassDeclaration,
  tool: Tool,
): MethodDeclaration {
  const methodName = camelCase(tool.name);
  const inputType = tool.inputSchema ? pascalCase(tool.name) + "Input" : "void";
  const outputType = hasOutputSchema(tool)
    ? pascalCase(tool.name) + "Output"
    : "any";

  const method = classDecl.addMethod({
    name: methodName,
    isAsync: true,
    parameters:
      inputType !== "void"
        ? [
            {
              name: "input",
              type: inputType,
            },
          ]
        : [],
    returnType: `Promise<${outputType}>`,
  });

  // Add JSDoc
  if (tool.description) {
    method.addJsDoc({
      description: tool.description,
    });
  }

  // Add implementation using helper function. Spread: an interface isn't assignable to the
  // SDK's Record<string, unknown> arguments, but an object literal type is.
  const callArgs = inputType !== "void" ? "{ ...input }" : "{}";
  method.addStatements([
    `const result = await this.connection.client.callTool({`,
    `  name: "${tool.name}",`,
    `  arguments: ${callArgs},`,
    `});`,
    `return handleToolResult(result, "${tool.name}");`,
  ]);

  return method;
}

/**
 * Generate methods for resources
 */
function generateResourceMethods(
  classDecl: ClassDeclaration,
  resources: Resource[],
): void {
  // Add a generic getResource method
  const method = classDecl.addMethod({
    name: "getResource",
    isAsync: true,
    parameters: [
      {
        name: "uri",
        type: "string",
      },
    ],
    returnType: `Promise<${RESOURCE_CONTENT_TYPE}>`,
  });

  method.addJsDoc({
    description: "Fetch a resource by URI",
    tags: [
      {
        tagName: "param",
        text: "uri - Resource URI",
      },
    ],
  });

  method.addStatements([
    `const result = await this.connection.client.readResource({ uri });`,
    `return handleResourceResult(result, uri);`,
  ]);

  // Add specific methods for known resources
  for (const resource of resources) {
    if (resource.name) {
      const resourceMethod = classDecl.addMethod({
        name: "get" + pascalCase(resource.name),
        isAsync: true,
        returnType: `Promise<${RESOURCE_CONTENT_TYPE}>`,
      });

      if (resource.description) {
        resourceMethod.addJsDoc({
          description: resource.description,
        });
      }

      resourceMethod.addStatements([
        `return this.getResource("${resource.uri}");`,
      ]);
    }
  }
}

/**
 * Generate methods for prompts
 */
function generatePromptMethods(
  classDecl: ClassDeclaration,
  prompts: Prompt[],
): void {
  for (const prompt of prompts) {
    const methodName = camelCase(prompt.name) + "Prompt";

    // Build parameter type
    const params: string[] = [];
    if (prompt.arguments) {
      for (const arg of prompt.arguments) {
        const optional = arg.required ? "" : "?";
        params.push(`${arg.name}${optional}: string`);
      }
    }

    const method = classDecl.addMethod({
      name: methodName,
      isAsync: true,
      parameters:
        params.length > 0
          ? [
              {
                name: "args",
                type: `{ ${params.join("; ")} }`,
              },
            ]
          : [],
      returnType: `Promise<${PROMPT_MESSAGE_TYPE}>`,
    });

    if (prompt.description) {
      method.addJsDoc({
        description: prompt.description,
      });
    }

    const argsParam = params.length > 0 ? "args" : "{}";
    method.addStatements([
      `const result = await this.connection.client.getPrompt({`,
      `  name: "${prompt.name}",`,
      `  arguments: ${argsParam},`,
      `});`,
      `return result.messages;`,
    ]);
  }
}

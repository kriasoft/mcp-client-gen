/**
 * MCP client class generation.
 *
 * One class per server: a method per tool, prompt and listed resource, plus a generic
 * resource reader. Names are allocated before emitting so distinct server names never
 * collide (e.g. `get-user` vs `get_user`, or a tool named `client`).
 *
 * SPDX-FileCopyrightText: 2025-present Kriasoft
 * SPDX-License-Identifier: MIT
 */

import type { Prompt, Resource, Tool } from "@modelcontextprotocol/client";
import type { ClassDeclaration, SourceFile } from "ts-morph";
import type { IntrospectionSuccess } from "../introspection.js";
import {
  generateToolInputType,
  generateToolOutputType,
  hasOptionalInput,
  hasOutputSchema,
} from "./tool-input-generator.js";
import {
  camelCase,
  commentText,
  pascalCase,
  propertyKey,
  uniqueName,
} from "./utils.js";

/** Members every generated class defines; tools/prompts/resources can't take these names. */
const RESERVED_MEMBERS = ["constructor", "client", "readResource"];

/**
 * Generate the client class (and its tool types) for one server.
 * @param typeNames Exported names already taken in the file; allocated names join it.
 */
export function generateClientClass(
  sourceFile: SourceFile,
  serverName: string,
  result: IntrospectionSuccess,
  typeNames: Set<string>,
): ClassDeclaration {
  const className = clientClassName(serverName);
  const members = new Set(RESERVED_MEMBERS);

  const classDecl = sourceFile.addClass({
    name: className,
    isExported: true,
    docs: [commentText(`MCP client for the \`${serverName}\` server.`)],
  });

  classDecl.addProperty({
    name: "#connection",
    type: "McpConnection",
    isReadonly: true,
  });

  classDecl.addConstructor({
    parameters: [{ name: "connection", type: "McpConnection" }],
    statements: ["this.#connection = connection;"],
  });

  classDecl.addGetAccessor({
    name: "client",
    returnType: "Client",
    docs: ["Underlying MCP client, for requests this class doesn't wrap."],
    statements: ["return this.#connection.client;"],
  });

  // Tools first: they get the plainest names
  for (const tool of result.tools) {
    const methodName = uniqueName(camelCase(tool.name), members);
    addToolMethod(
      sourceFile,
      classDecl,
      tool,
      methodName,
      serverName,
      typeNames,
    );
  }
  for (const prompt of result.prompts) {
    const methodName = uniqueName(camelCase(prompt.name) + "Prompt", members);
    addPromptMethod(classDecl, prompt, methodName);
  }
  // Servers may serve resources through templates without listing any
  if (result.capabilities.resources || result.resources.length > 0) {
    addReadResourceMethod(classDecl);
    for (const resource of result.resources) {
      const methodName = uniqueName(
        "read" + pascalCase(resource.name),
        members,
      );
      addResourceMethod(classDecl, resource, methodName);
    }
  }

  return classDecl;
}

/** Class name for a server; the pipeline rejects servers whose names map to the same one. */
export function clientClassName(serverName: string): string {
  return pascalCase(serverName) + "Client";
}

function addToolMethod(
  sourceFile: SourceFile,
  classDecl: ClassDeclaration,
  tool: Tool,
  methodName: string,
  serverName: string,
  typeNames: Set<string>,
): void {
  const typeBase = allocateTypeBase(
    pascalCase(methodName),
    pascalCase(serverName),
    typeNames,
  );
  const inputType = `${typeBase}Input`;
  generateToolInputType(sourceFile, tool, inputType);
  const outputType = hasOutputSchema(tool) ? `${typeBase}Output` : undefined;
  if (outputType) generateToolOutputType(sourceFile, tool, outputType);

  const wireName = JSON.stringify(tool.name);
  classDecl.addMethod({
    name: methodName,
    isAsync: true,
    parameters: [
      {
        name: "input",
        type: inputType,
        ...(hasOptionalInput(tool) && { initializer: "{}" }),
      },
    ],
    returnType: `Promise<${outputType ?? "CallToolResult"}>`,
    docs: tool.description ? [commentText(tool.description)] : [],
    statements: [
      `const result = await this.#connection.client.callTool({ name: ${wireName}, arguments: input });`,
      outputType
        ? `return structuredResult<${outputType}>(result, ${wireName});`
        : `return toolResult(result, ${wireName});`,
    ],
  });
}

function addPromptMethod(
  classDecl: ClassDeclaration,
  prompt: Prompt,
  methodName: string,
): void {
  const args = prompt.arguments ?? [];
  const argsType = `{ ${args
    .map((arg) => `${propertyKey(arg.name)}${arg.required ? "" : "?"}: string`)
    .join("; ")} }`;
  const optional = !args.some((arg) => arg.required);

  classDecl.addMethod({
    name: methodName,
    isAsync: true,
    parameters: args.length
      ? [
          {
            name: "args",
            type: argsType,
            ...(optional && { initializer: "{}" }),
          },
        ]
      : [],
    returnType: "Promise<PromptMessage[]>",
    docs: prompt.description ? [commentText(prompt.description)] : [],
    statements: [
      `const result = await this.#connection.client.getPrompt({ name: ${JSON.stringify(prompt.name)}${args.length ? ", arguments: args" : ""} });`,
      "return result.messages;",
    ],
  });
}

function addReadResourceMethod(classDecl: ClassDeclaration): void {
  classDecl.addMethod({
    name: "readResource",
    isAsync: true,
    parameters: [{ name: "uri", type: "string" }],
    returnType: `Promise<ReadResourceResult["contents"]>`,
    docs: ["Read a resource by URI (listed or from a resource template)."],
    statements: [
      "const result = await this.#connection.client.readResource({ uri });",
      "return result.contents;",
    ],
  });
}

function addResourceMethod(
  classDecl: ClassDeclaration,
  resource: Resource,
  methodName: string,
): void {
  const docs = [resource.description, `URI: ${resource.uri}`]
    .filter(Boolean)
    .join("\n\n");
  classDecl.addMethod({
    name: methodName,
    returnType: `Promise<ReadResourceResult["contents"]>`,
    docs: [commentText(docs)],
    statements: [`return this.readResource(${JSON.stringify(resource.uri)});`],
  });
}

/**
 * Type name stem for a tool: `{Method}` if free, else `{Server}{Method}` (the same tool
 * name on another server), else numbered. Reserves both its Input and Output names.
 */
function allocateTypeBase(
  base: string,
  serverPrefix: string,
  typeNames: Set<string>,
): string {
  const free = (stem: string) =>
    !typeNames.has(`${stem}Input`) && !typeNames.has(`${stem}Output`);
  let stem = free(base) ? base : `${serverPrefix}${base}`;
  for (let n = 2; !free(stem); n++) stem = `${serverPrefix}${base}${n}`;
  typeNames.add(`${stem}Input`).add(`${stem}Output`);
  return stem;
}

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

/**
 * Names tools/prompts/resources can't take: members every class defines, and `then`,
 * which would make the client a thenable (`await`-ing it would call that tool).
 */
const RESERVED_MEMBERS = ["constructor", "client", "readResource", "then"];

/** Trailing parameter of every generated method: per-call timeout, signal, progress. */
const OPTIONS_PARAM = {
  name: "options",
  type: "RequestOptions",
  hasQuestionToken: true,
};

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

  // Allocate names and emit tool types first, so they precede the class
  const tools = result.tools.map((tool) => {
    const methodName = uniqueName(camelCase(tool.name), members);
    return {
      tool,
      methodName,
      ...addToolTypes(sourceFile, tool, methodName, serverName, typeNames),
    };
  });

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

  // Tools were named first: they get the plainest names
  for (const entry of tools) addToolMethod(classDecl, entry);
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

/** Emit a tool's input (and output) types; returns their names. */
function addToolTypes(
  sourceFile: SourceFile,
  tool: Tool,
  methodName: string,
  serverName: string,
  typeNames: Set<string>,
): { inputType: string; outputType?: string } {
  const typeBase = allocateTypeBase(
    pascalCase(methodName),
    pascalCase(serverName),
    typeNames,
  );
  const inputType = `${typeBase}Input`;
  generateToolInputType(sourceFile, tool, inputType);
  if (!hasOutputSchema(tool)) return { inputType };
  const outputType = `${typeBase}Output`;
  generateToolOutputType(sourceFile, tool, outputType);
  return { inputType, outputType };
}

function addToolMethod(
  classDecl: ClassDeclaration,
  {
    tool,
    methodName,
    inputType,
    outputType,
  }: { tool: Tool; methodName: string; inputType: string; outputType?: string },
): void {
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
      OPTIONS_PARAM,
    ],
    returnType: `Promise<${outputType ?? "CallToolResult"}>`,
    docs: tool.description ? [commentText(tool.description)] : [],
    statements: [
      `const result = await this.#connection.client.callTool({ name: ${wireName}, arguments: input }, options);`,
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
    parameters: [
      ...(args.length
        ? [
            {
              name: "args",
              type: argsType,
              ...(optional && { initializer: "{}" }),
            },
          ]
        : []),
      OPTIONS_PARAM,
    ],
    returnType: "Promise<PromptMessage[]>",
    docs: prompt.description ? [commentText(prompt.description)] : [],
    statements: [
      `const result = await this.#connection.client.getPrompt({ name: ${JSON.stringify(prompt.name)}${args.length ? ", arguments: args" : ""} }, options);`,
      "return result.messages;",
    ],
  });
}

function addReadResourceMethod(classDecl: ClassDeclaration): void {
  classDecl.addMethod({
    name: "readResource",
    isAsync: true,
    parameters: [{ name: "uri", type: "string" }, OPTIONS_PARAM],
    returnType: `Promise<ReadResourceResult["contents"]>`,
    docs: ["Read a resource by URI (listed or from a resource template)."],
    statements: [
      "const result = await this.#connection.client.readResource({ uri }, options);",
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
    parameters: [OPTIONS_PARAM],
    returnType: `Promise<ReadResourceResult["contents"]>`,
    docs: [commentText(docs)],
    statements: [
      `return this.readResource(${JSON.stringify(resource.uri)}, options);`,
    ],
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

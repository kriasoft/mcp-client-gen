/**
 * MCP client generation (ADR-003).
 *
 * One factory per server, taking the SDK `Client` and returning an object literal: a
 * method per tool, prompt and listed resource, plus a generic resource reader. Methods
 * delegate to the SDK and return its full results. Member names are allocated so distinct
 * server names never collide (e.g. `get-user` vs `get_user`); tool type names derive from
 * them (`{Member}Input`/`Output`), so they are unique too.
 *
 * SPDX-FileCopyrightText: 2025-present Kriasoft
 * SPDX-License-Identifier: MIT
 */

import type { Prompt, Resource, Tool } from "@modelcontextprotocol/client";
import type { SourceFile } from "ts-morph";
import type { Introspection } from "../introspection.js";
import {
  generateToolInputType,
  generateToolOutputType,
  hasOptionalInput,
  hasOutputSchema,
} from "./tool-input-generator.js";
import {
  camelCase,
  commentText,
  docComment,
  pascalCase,
  propertyKey,
  uniqueName,
} from "./utils.js";

/**
 * Names tools/prompts/resources can't take: the generic reader, and `then`, which would
 * make the client a thenable (`await`-ing it would call that tool).
 */
const RESERVED_MEMBERS = ["readResource", "then"];

/** Generate the factory, its client type and its tool types for one server. */
export function generateServerClient(
  sourceFile: SourceFile,
  serverName: string,
  result: Introspection,
): void {
  const typeName = clientTypeName(serverName);
  const factoryName = `create${typeName}`;
  const members = new Set(RESERVED_MEMBERS);
  const methods: string[] = [];

  // Tools are named first: they get the plainest names. Their types precede the factory.
  for (const tool of result.tools) {
    const name = uniqueName(camelCase(tool.name), members);
    const types = addToolTypes(sourceFile, tool, name);
    methods.push(toolMethod(tool, name, types));
  }
  for (const prompt of result.prompts) {
    const name = uniqueName(camelCase(prompt.name) + "Prompt", members);
    methods.push(promptMethod(prompt, name));
  }
  // Servers may serve resources through templates without listing any
  if (result.capabilities.resources || result.resources.length > 0) {
    methods.push(
      method(
        "Read a resource by URI (listed or from a resource template).",
        "readResource(uri: string, options?: RequestOptions): Promise<ReadResourceResult>",
        "return client.readResource({ uri }, options);",
      ),
    );
    for (const resource of result.resources) {
      const name = uniqueName("read" + pascalCase(resource.name), members);
      methods.push(resourceMethod(resource, name));
    }
  }

  sourceFile.addFunction({
    name: factoryName,
    isExported: true,
    parameters: [{ name: "client", type: "Client" }],
    docs: [
      commentText(
        `Client for the \`${serverName}\` MCP server; \`client\` must be connected.`,
      ),
    ],
    statements: [`return {\n${methods.join("\n\n")}\n};`],
  });
  sourceFile.addTypeAlias({
    name: typeName,
    isExported: true,
    type: `ReturnType<typeof ${factoryName}>`,
  });
}

/** Client type name for a server; its factory is `create` + this. */
export function clientTypeName(serverName: string): string {
  return pascalCase(serverName) + "Client";
}

/** Emit a tool's input (and output) types; returns their names. */
function addToolTypes(
  sourceFile: SourceFile,
  tool: Tool,
  methodName: string,
): { inputType: string; outputType?: string } {
  const typeBase = pascalCase(methodName);
  const inputType = `${typeBase}Input`;
  generateToolInputType(sourceFile, tool, inputType);
  if (!hasOutputSchema(tool)) return { inputType };
  const outputType = `${typeBase}Output`;
  generateToolOutputType(sourceFile, tool, outputType);
  return { inputType, outputType };
}

function toolMethod(
  tool: Tool,
  name: string,
  { inputType, outputType }: { inputType: string; outputType?: string },
): string {
  const input = hasOptionalInput(tool)
    ? `input: ${inputType} = {}`
    : `input: ${inputType}`;
  const call = `client.callTool({ name: ${JSON.stringify(tool.name)}, arguments: input }, options)`;
  // The SDK returns CallToolResult; the output schema narrows its structuredContent
  const returnType = outputType
    ? `Promise<ToolResult<${outputType}>>`
    : "Promise<CallToolResult>";
  return method(
    tool.description,
    `${name}(${input}, options?: CallToolRequestOptions): ${returnType}`,
    outputType ? `return ${call} as ${returnType};` : `return ${call};`,
  );
}

function promptMethod(prompt: Prompt, name: string): string {
  const args = prompt.arguments ?? [];
  const params = ["options?: RequestOptions"];
  if (args.length) {
    const argsType = `{ ${args
      .map((a) => `${propertyKey(a.name)}${a.required ? "" : "?"}: string`)
      .join("; ")} }`;
    const optional = !args.some((a) => a.required);
    params.unshift(`args: ${argsType}${optional ? " = {}" : ""}`);
  }
  const request = `{ name: ${JSON.stringify(prompt.name)}${args.length ? ", arguments: args" : ""} }`;
  return method(
    prompt.description,
    `${name}(${params.join(", ")}): Promise<GetPromptResult>`,
    `return client.getPrompt(${request}, options);`,
  );
}

function resourceMethod(resource: Resource, name: string): string {
  const docs = [resource.description, `URI: ${resource.uri}`]
    .filter(Boolean)
    .join("\n\n");
  return method(
    docs,
    `${name}(options?: RequestOptions): Promise<ReadResourceResult>`,
    `return client.readResource({ uri: ${JSON.stringify(resource.uri)} }, options);`,
  );
}

/** Object-literal method with optional JSDoc. */
function method(
  docs: string | undefined,
  signature: string,
  body: string,
): string {
  const doc = docs?.trim() ? docComment(docs) + "\n" : "";
  return `${doc}${signature} {\n${body}\n},`;
}

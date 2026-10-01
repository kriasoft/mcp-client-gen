/**
 * MCP client generation (ADR-003).
 *
 * One factory per server, taking the SDK `Client` and returning an object literal: a
 * method per tool, prompt, listed resource and simple resource template, plus a generic
 * resource reader. Methods
 * delegate to the SDK and return its full results. Member names are allocated so distinct
 * server names never collide (e.g. `get-user` vs `get_user`); tool type names derive from
 * them (`{Member}Input`/`Output`), recursive-ref aliases from those.
 *
 * SPDX-FileCopyrightText: 2025-present Kriasoft
 * SPDX-License-Identifier: MIT
 */

import type {
  Prompt,
  Resource,
  ResourceTemplateType,
  Tool,
} from "@modelcontextprotocol/client";
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

  // Tools are named first: they get the plainest names. Their type names are reserved
  // before any is emitted, so aliases for recursive refs can't take a later tool's.
  const typeNames = new Set([typeName]);
  const prefix = sharedServerPrefix(serverName, result.tools);
  const tools = result.tools.map((tool) => {
    const name = uniqueName(camelCase(tool.name.slice(prefix)), members);
    const base = pascalCase(name);
    const inputType = uniqueName(`${base}Input`, typeNames);
    const outputType = hasOutputSchema(tool)
      ? uniqueName(`${base}Output`, typeNames)
      : undefined;
    return { tool, name, inputType, outputType };
  });
  for (const { tool, name, inputType, outputType } of tools) {
    generateToolInputType(sourceFile, tool, inputType, typeNames);
    if (outputType)
      generateToolOutputType(sourceFile, tool, outputType, typeNames);
    methods.push(toolMethod(tool, name, { inputType, outputType }));
  }
  for (const prompt of result.prompts) {
    const name = uniqueName(camelCase(prompt.name) + "Prompt", members);
    methods.push(promptMethod(prompt, name));
  }
  if (hasResources(result)) {
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
    for (const template of result.resourceTemplates) {
      const uri = expandSimpleTemplate(template.uriTemplate);
      if (!uri) continue; // operators like {?q}: readResource(uri) covers them
      const name = uniqueName("read" + pascalCase(template.name), members);
      methods.push(templateMethod(template, name, uri));
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

/** Whether the client reads resources; servers may serve them only through templates. */
export function hasResources(result: Introspection): boolean {
  return (
    !!result.capabilities.resources ||
    result.resources.length > 0 ||
    result.resourceTemplates.length > 0
  );
}

/**
 * Length of `{server}-` / `{server}_` when every tool name starts with it (`notion-search`
 * → `search`): the client is the namespace already. Otherwise 0, keeping names as-is.
 * Wire names are never changed.
 */
function sharedServerPrefix(serverName: string, tools: Tool[]): number {
  const server = serverName.toLowerCase();
  const prefixed = (name: string) =>
    name.length > server.length + 1 &&
    name.toLowerCase().startsWith(server) &&
    "-_".includes(name[server.length]!);
  return tools.length > 0 && tools.every((tool) => prefixed(tool.name))
    ? server.length + 1
    : 0;
}

/** Client type name for a server; its factory is `create` + this. */
export function clientTypeName(serverName: string): string {
  return pascalCase(serverName) + "Client";
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

function templateMethod(
  template: ResourceTemplateType,
  name: string,
  { variables, literal }: { variables: string[]; literal: string },
): string {
  const docs = [template.description, `URI template: ${template.uriTemplate}`]
    .filter(Boolean)
    .join("\n\n");
  const params = variables.length
    ? `params: { ${variables.map((v) => `${propertyKey(v)}: string`).join("; ")} }, `
    : "";
  return method(
    docs,
    `${name}(${params}options?: RequestOptions): Promise<ReadResourceResult>`,
    `return client.readResource({ uri: ${literal} }, options);`,
  );
}

/**
 * Template literal expanding an RFC 6570 level-1 template (`repo://{owner}/{repo}`), each
 * value percent-encoded like the SDK's `UriTemplate`; undefined for other templates.
 */
function expandSimpleTemplate(
  uriTemplate: string,
): { variables: string[]; literal: string } | undefined {
  const variables: string[] = [];
  let literal = "";
  // Odd indexes are `{…}` expressions
  for (const [i, part] of uriTemplate.split(/(\{[^{}]*\})/).entries()) {
    if (i % 2 === 0) {
      if (/[{}]/.test(part)) return undefined; // unbalanced braces
      literal += part.replace(/[`\\]/g, "\\$&"); // braces excluded, so `${` can't occur
      continue;
    }
    const variable = part.slice(1, -1);
    if (!VARNAME.test(variable)) return undefined; // operator, modifier or list
    if (!variables.includes(variable)) variables.push(variable);
    literal += `\${encodeURIComponent(params${propertyAccess(variable)})}`;
  }
  return { variables, literal: `\`${literal}\`` };
}

/** RFC 6570 varname: word chars and pct-encoded octets, dot-separated. */
const VARNAME = /^(?:\w|%[0-9A-Fa-f]{2})+(?:\.(?:\w|%[0-9A-Fa-f]{2})+)*$/;

/** `.name` when `name` is an identifier, else `["name"]`. */
function propertyAccess(name: string): string {
  const key = propertyKey(name);
  return key === name ? `.${name}` : `[${key}]`;
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

/**
 * MCP client generation (ADR-003).
 *
 * One factory per server, taking the SDK `Client` and returning an object literal: a
 * method per tool, then `prompts` (a method per prompt) and `resources` (a generic reader,
 * a method per listed resource and simple resource template). Methods delegate to the SDK
 * and return its full results. Names are allocated per object so distinct server names
 * never collide (e.g. `get-user` vs `get_user`); tool type names derive from them
 * (`{Member}Input`/`Output`), recursive-ref aliases from those.
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
import type { ServerSnapshot } from "../introspection.js";
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
 * Names no object in the client may hold: `then` would make it a thenable (`await`-ing
 * it, or returning it from an async function, would call that method), and
 * `JSON.stringify` calls `toJSON`, nested objects included.
 */
const RESERVED = ["then", "toJSON"];

/**
 * Generate the factory, its client type and its tool types for one server. Everything is
 * emitted in wire-name order, not listing order, so a reordered catalog changes nothing.
 */
export function generateServerClient(
  sourceFile: SourceFile,
  serverName: string,
  result: ServerSnapshot,
): void {
  const typeName = clientTypeName(serverName);
  const factoryName = `create${typeName}`;
  const members: string[] = [];

  // Tools own the top level; the namespaces are reserved even when absent, so a server
  // adding its first prompt renames no tool. Unprefixed tools are named first, so `search`
  // keeps its name beside `notion-search`. Type names are reserved before any is
  // emitted, so aliases for recursive refs can't take a later tool's.
  const topLevel = new Set(["prompts", "resources", ...RESERVED]);
  const typeNames = new Set([typeName]);
  const strip = serverPrefixStripper(serverName);
  const tools = byWireName(result.tools, (tool) => tool.name);
  const toolNames = new Map<Tool, ToolNames>();
  for (const isPrefixed of [false, true])
    for (const tool of tools.filter((t) => !!strip(t.name) === isPrefixed)) {
      // `notion-search` → `search`, unless taken: then `notionSearch`
      const stripped = strip(tool.name);
      const preferred =
        stripped && !topLevel.has(camelCase(stripped)) ? stripped : tool.name;
      const name = uniqueName(camelCase(preferred), topLevel);
      const base = pascalCase(name);
      toolNames.set(tool, {
        name,
        inputType: uniqueName(`${base}Input`, typeNames),
        outputType: hasOutputSchema(tool)
          ? uniqueName(`${base}Output`, typeNames)
          : undefined,
      });
    }
  for (const tool of tools) {
    const { name, inputType, outputType } = toolNames.get(tool)!;
    generateToolInputType(sourceFile, tool, inputType, typeNames);
    if (outputType)
      generateToolOutputType(sourceFile, tool, outputType, typeNames);
    members.push(toolMethod(tool, name, { inputType, outputType }));
  }

  if (result.prompts.length > 0) {
    const promptNames = allocate(
      result.prompts,
      (prompt) => prompt.name,
      (prompt) => camelCase(prompt.name),
      new Set(RESERVED),
    );
    members.push(
      namespace(
        "Prompt templates from the server.",
        "prompts",
        [...promptNames].map(([prompt, name]) => promptMethod(prompt, name)),
      ),
    );
  }

  if (hasResources(result)) {
    // Listed resources are named before templates
    const taken = new Set(["read", ...RESERVED]);
    const resourceNames = allocate(
      result.resources,
      (resource) => `${resource.name}\0${resource.uri}`,
      (resource) => camelCase(resource.name),
      taken,
    );
    // Operators like {?q} aren't expanded: read(uri) covers them
    const templates = result.resourceTemplates.flatMap((template) => {
      const uri = expandSimpleTemplate(template.uriTemplate);
      return uri ? [{ template, uri }] : [];
    });
    const templateNames = allocate(
      templates,
      ({ template }) => `${template.name}\0${template.uriTemplate}`,
      ({ template }) => camelCase(template.name),
      taken,
    );
    members.push(
      namespace(
        "Resources: `read(uri)` reads any URI; the others read a listed resource or fill a URI template.",
        "resources",
        [
          method(
            "Read a resource by URI (listed or from a resource template).",
            "read(uri: string, options?: CacheableRequestOptions): Promise<ReadResourceResult>",
            "return client.readResource({ uri }, options);",
          ),
          ...[...resourceNames].map(([resource, name]) =>
            resourceMethod(resource, name),
          ),
          ...[...templateNames].map(([{ template, uri }, name]) =>
            templateMethod(template, name, uri),
          ),
        ],
      ),
    );
  }

  sourceFile.addFunction({
    name: factoryName,
    isExported: true,
    parameters: [{ name: "client", type: clientParameterType(result) }],
    docs: [commentText(factoryDoc(serverName, result))],
    statements: [
      ...(eraBound(result) ? [eraGuard(factoryName, result)] : []),
      `return {\n${members.join("\n\n")}\n};`,
    ],
  });
  sourceFile.addTypeAlias({
    name: typeName,
    isExported: true,
    type: `ReturnType<typeof ${factoryName}>`,
  });
}

/**
 * Only the `Client` methods this module calls: the SDK class has private members, so a
 * structural parameter is what lets a test double (or another SDK copy) stand in.
 */
function clientParameterType(result: ServerSnapshot): string {
  const used = [
    result.tools.length > 0 && "callTool",
    result.prompts.length > 0 && "getPrompt",
    eraBound(result) && "getProtocolEra",
    hasResources(result) && "readResource",
  ].filter((name) => name !== false);
  return `Pick<Client, ${used.map((name) => JSON.stringify(name)).join(" | ") || "never"}>`;
}

interface ToolNames {
  name: string;
  inputType: string;
  outputType?: string;
}

/**
 * Whether the output types hold only for a client of the generation's era. Toward legacy
 * clients the SDK wraps a non-object `outputSchema` root, and its structured content, in
 * `{ result }`: a modern snapshot is era-bound when a root isn't an object (the SDK's
 * test), a legacy one when a schema has that wrapper's shape (genuine or not).
 */
function eraBound({ protocolEra, tools }: ServerSnapshot): boolean {
  return tools.some(({ outputSchema: schema }) => {
    if (!schema) return false;
    if (protocolEra === "modern") return schema.type !== "object";
    const keys = Object.keys(schema.properties ?? {});
    return (
      keys.length === 1 &&
      keys[0] === "result" &&
      Array.isArray(schema.required) &&
      schema.required.includes("result")
    );
  });
}

/** Factory statement rejecting a client of the other era. */
function eraGuard(factoryName: string, result: ServerSnapshot): string {
  const remedy =
    result.protocolEra === "modern"
      ? 'connect the Client with versionNegotiation: { mode: "auto" }'
      : "connect the Client without versionNegotiation, or regenerate";
  const message = `${factoryName}: generated for MCP ${result.protocolVersion} (${result.protocolEra} era); ${remedy}`;
  return `if (client.getProtocolEra() !== ${JSON.stringify(result.protocolEra)}) throw new Error(${JSON.stringify(message)});`;
}

function factoryDoc(serverName: string, result: ServerSnapshot): string {
  const negotiation =
    result.protocolEra === "modern"
      ? ` with \`versionNegotiation: { mode: "auto" }\` (generated for MCP ${result.protocolVersion})`
      : "";
  return [
    `Client for the \`${serverName}\` MCP server; \`client\` must be connected${negotiation}.`,
    ...(result.tools.length > 0
      ? [
          "Call `client.listTools()` once before using tools: the SDK uses the definitions to validate typed results and to send `x-mcp-header` arguments as headers.",
        ]
      : []),
  ].join("\n\n");
}

/** `item → name`, allocated in `key` order so the listing order can't change names. */
function allocate<T>(
  items: T[],
  key: (item: T) => string,
  name: (item: T) => string,
  taken: Set<string>,
): Map<T, string> {
  return new Map(
    byWireName(items, key).map((item) => [item, uniqueName(name(item), taken)]),
  );
}

/**
 * Sorted by code point: locale-independent, so output is the same everywhere. Items
 * sharing a key (a server bug) are ordered by their JSON, so no listing order shows.
 */
function byWireName<T>(items: T[], key: (item: T) => string): T[] {
  const compare = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
  return items.toSorted(
    (a, b) =>
      compare(key(a), key(b)) || compare(JSON.stringify(a), JSON.stringify(b)),
  );
}

/** Whether the client reads resources; servers may serve them only through templates. */
export function hasResources(result: ServerSnapshot): boolean {
  return (
    !!result.capabilities.resources ||
    result.resources.length > 0 ||
    result.resourceTemplates.length > 0
  );
}

/**
 * Strips `{server}-` / `{server}_` from a tool name (`notion-search` → `search`): the
 * client is the namespace already. Per tool, so adding an unprefixed tool renames none.
 * Returns undefined when the name has no such prefix. Wire names are never changed.
 */
function serverPrefixStripper(
  serverName: string,
): (toolName: string) => string | undefined {
  const server = serverName.toLowerCase();
  return (name) =>
    name.length > server.length + 1 &&
    name.toLowerCase().startsWith(server) &&
    "-_".includes(name[server.length]!)
      ? name.slice(server.length + 1)
      : undefined;
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
  // A name declared twice is one argument, required only if every declaration says so
  // (a duplicate property wouldn't compile)
  const args = [...Map.groupBy(prompt.arguments ?? [], (a) => a.name)].map(
    ([arg, decls]) => ({ name: arg, required: decls.every((a) => a.required) }),
  );
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
    `${name}(options?: CacheableRequestOptions): Promise<ReadResourceResult>`,
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
    `${name}(${params}options?: CacheableRequestOptions): Promise<ReadResourceResult>`,
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

/** Object-literal property holding `methods`, with JSDoc. */
function namespace(docs: string, name: string, methods: string[]): string {
  return `${docComment(docs)}\n${name}: {\n${methods.join("\n\n")}\n},`;
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

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
 * Names tools/prompts/resources can't take: the generic reader; `then`, which would make
 * the client a thenable (`await`-ing it would call that tool); and `toJSON`, which
 * `JSON.stringify` would call.
 */
const RESERVED_MEMBERS = ["readResource", "then", "toJSON"];

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

  // Names are allocated in wire-name order, not listing order, so a reordered catalog
  // renames nothing. Tools first: they get the plainest names. Unprefixed tools before
  // prefixed ones, so `search` keeps its name beside `notion-search`. Type names are
  // reserved before any is emitted, so aliases for recursive refs can't take a later
  // tool's.
  const typeNames = new Set([typeName]);
  const strip = serverPrefixStripper(serverName);
  const toolNames = new Map<Tool, ToolNames>();
  const [unprefixed, prefixed] = [false, true].map((isPrefixed) =>
    byWireName(
      result.tools.filter((tool) => !!strip(tool.name) === isPrefixed),
      (tool) => tool.name,
    ),
  );
  for (const tool of [...unprefixed!, ...prefixed!]) {
    // `notion-search` → `search`, unless taken: then `notionSearch`
    const stripped = strip(tool.name);
    const preferred =
      stripped && !members.has(camelCase(stripped)) ? stripped : tool.name;
    const name = uniqueName(camelCase(preferred), members);
    const base = pascalCase(name);
    toolNames.set(tool, {
      name,
      inputType: uniqueName(`${base}Input`, typeNames),
      outputType: hasOutputSchema(tool)
        ? uniqueName(`${base}Output`, typeNames)
        : undefined,
    });
  }
  for (const tool of result.tools) {
    const { name, inputType, outputType } = toolNames.get(tool)!;
    generateToolInputType(sourceFile, tool, inputType, typeNames);
    if (outputType)
      generateToolOutputType(sourceFile, tool, outputType, typeNames);
    methods.push(toolMethod(tool, name, { inputType, outputType }));
  }

  const promptNames = allocate(
    result.prompts,
    (prompt) => prompt.name,
    // Not `summarizePromptPrompt`
    (prompt) => camelCase(prompt.name).replace(/(Prompt)?$/, "Prompt"),
    members,
  );
  for (const prompt of result.prompts)
    methods.push(promptMethod(prompt, promptNames.get(prompt)!));

  if (hasResources(result)) {
    methods.push(
      method(
        "Read a resource by URI (listed or from a resource template).",
        "readResource(uri: string, options?: RequestOptions): Promise<ReadResourceResult>",
        "return client.readResource({ uri }, options);",
      ),
    );
    const resourceNames = allocate(
      result.resources,
      (resource) => `${resource.name}\0${resource.uri}`,
      (resource) => "read" + pascalCase(resource.name),
      members,
    );
    for (const resource of result.resources)
      methods.push(resourceMethod(resource, resourceNames.get(resource)!));
    // Operators like {?q} aren't expanded: readResource(uri) covers them
    const templates = result.resourceTemplates.flatMap((template) => {
      const uri = expandSimpleTemplate(template.uriTemplate);
      return uri ? [{ template, uri }] : [];
    });
    const templateNames = allocate(
      templates,
      ({ template }) => `${template.name}\0${template.uriTemplate}`,
      ({ template }) => "read" + pascalCase(template.name),
      members,
    );
    for (const entry of templates)
      methods.push(
        templateMethod(entry.template, templateNames.get(entry)!, entry.uri),
      );
  }

  sourceFile.addFunction({
    name: factoryName,
    isExported: true,
    parameters: [{ name: "client", type: "Client" }],
    docs: [commentText(factoryDoc(serverName, result))],
    statements: [
      ...(eraBound(result) ? [eraGuard(factoryName, result)] : []),
      `return {\n${methods.join("\n\n")}\n};`,
    ],
  });
  sourceFile.addTypeAlias({
    name: typeName,
    isExported: true,
    type: `ReturnType<typeof ${factoryName}>`,
  });
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
function eraBound({ protocolEra, tools }: Introspection): boolean {
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
function eraGuard(factoryName: string, result: Introspection): string {
  const remedy =
    result.protocolEra === "modern"
      ? 'connect the Client with versionNegotiation: { mode: "auto" }'
      : "connect the Client without versionNegotiation, or regenerate";
  const message = `${factoryName}: generated for MCP ${result.protocolVersion} (${result.protocolEra} era); ${remedy}`;
  return `if (client.getProtocolEra() !== ${JSON.stringify(result.protocolEra)}) throw new Error(${JSON.stringify(message)});`;
}

function factoryDoc(serverName: string, result: Introspection): string {
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

/** Sorted by code point: locale-independent, so output is the same everywhere. */
function byWireName<T>(items: T[], key: (item: T) => string): T[] {
  return items.toSorted((a, b) =>
    key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0,
  );
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

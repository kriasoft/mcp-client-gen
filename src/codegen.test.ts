/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import type { Tool } from "@modelcontextprotocol/client";
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  ModuleKind,
  ModuleResolutionKind,
  Project,
  ScriptTarget,
  ts,
} from "ts-morph";
import {
  camelCase,
  generateClientFile,
  jsonSchemaToTypeScript,
  pascalCase,
  schemaTypeAliases,
} from "./codegen/index.js";
import type { ServerSnapshot } from "./introspection.js";
import { extractServerName, formatTypeScript } from "./pipeline.js";

describe("extractServerName", () => {
  const name = (url: string, explicit?: string) =>
    extractServerName({ url, name: explicit });

  test("uses explicit name when provided", () => {
    expect(name("https://example.com", "myServer")).toBe("myServer");
    // An empty config key never falls back to the (possibly secret-bearing) URL
    expect(name("https://notion.com", "")).toBe("server");
  });

  test("extracts domain name from URL", () => {
    expect(name("https://notion.com/mcp")).toBe("notion");
    expect(name("https://api.github.com/v1/mcp")).toBe("github");
  });

  test("handles subdomains correctly", () => {
    expect(name("https://api.notion.com")).toBe("notion");
    expect(name("https://www.example.com")).toBe("example");
  });

  test("falls back to path segment", () => {
    expect(name("https://api.com/notion/v1")).toBe("notion");
  });

  test("skips a country second-level suffix", () => {
    expect(name("https://api.example.co.uk/mcp")).toBe("example");
    expect(name("https://example.com.au")).toBe("example");
  });

  test("ignores IP and localhost hosts", () => {
    expect(name("http://127.0.0.1:8080/mcp")).toBe("server");
    expect(name("http://localhost:3000/github")).toBe("github");
    expect(name("http://[::1]:3000/mcp")).toBe("server");
  });

  test('falls back to "server" for unresolvable URLs', () => {
    expect(name("https://api.com")).toBe("server");
    expect(name("invalid-url")).toBe("server");
  });
});

describe("formatTypeScript", () => {
  test("fails on code it can't parse instead of returning it", async () => {
    await expect(formatTypeScript("export const = ;")).rejects.toThrow(
      "Failed to format generated code",
    );
  });
});

describe("pascalCase / camelCase", () => {
  test("convert separators and casing", () => {
    expect(pascalCase("get-user_profile")).toBe("GetUserProfile");
    expect(camelCase("notion-search")).toBe("notionSearch");
    expect(camelCase("Get User")).toBe("getUser");
  });

  test("keep results valid identifiers", () => {
    expect(pascalCase("2fa")).toBe("_2fa");
    expect(camelCase("123")).toBe("_123");
    expect(pascalCase("!!!")).toBe("Unknown");
    expect(camelCase("")).toBe("unknown");
    // Reserved words are fine as member and type names
    expect(camelCase("delete")).toBe("delete");
  });
});

describe("jsonSchemaToTypeScript", () => {
  const ts = jsonSchemaToTypeScript;

  test("primitives and boolean schemas", () => {
    expect(ts({ type: "string" })).toBe("string");
    expect(ts({ type: "integer" })).toBe("number");
    expect(ts({ type: "null" })).toBe("null");
    expect(ts(true)).toBe("unknown");
    expect(ts(false)).toBe("never");
    expect(ts(undefined)).toBe("unknown");
    expect(ts({})).toBe("unknown");
  });

  test("const and enum literals of any type, safely escaped", () => {
    expect(ts({ const: 'say "hi"' })).toBe('"say \\"hi\\""');
    expect(ts({ enum: [1, 2] })).toBe("1 | 2");
    expect(ts({ type: "string", enum: ["a", null] })).toBe('"a" | null');
  });

  test("arrays group compound item types", () => {
    expect(ts({ type: "array", items: { type: "string" } })).toBe("string[]");
    expect(
      ts({
        type: "array",
        items: { anyOf: [{ type: "string" }, { type: "number" }] },
      }),
    ).toBe("(string | number)[]");
  });

  test("tuples follow the declared dialect's keyword", () => {
    const pair = [{ type: "string" }, { type: "number" }];
    const draft07 = "http://json-schema.org/draft-07/schema#";
    const v2020 = "https://json-schema.org/draft/2020-12/schema";
    // prefixItems isn't a draft-07 keyword: any array
    expect(ts({ $schema: draft07, type: "array", prefixItems: pair })).toBe(
      "unknown[]",
    );
    expect(
      ts({ $schema: draft07, type: "array", items: pair, minItems: 2 }),
    ).toBe("[string, number, ...unknown[]]");
    // A pointer into a nested resource takes that resource's dialect
    expect(
      ts({
        $schema: "https://json-schema.org/draft/2019-09/schema",
        $ref: "#/$defs/child/$defs/tuple",
        $defs: {
          child: {
            $id: "child",
            $schema: v2020,
            $defs: {
              tuple: {
                prefixItems: [{ type: "string" }],
                items: false,
                minItems: 1,
              },
            },
          },
        },
      }),
    ).toBe("[string]");
    // An items array isn't a 2020-12 tuple
    expect(ts({ $schema: v2020, type: "array", items: pair })).toBe(
      "unknown[]",
    );
  });

  test("tuples: positions past minItems are optional, rest from items", () => {
    const pair = [
      { type: "string" },
      { anyOf: [{ type: "number" }, { type: "null" }] },
    ];
    expect(ts({ type: "array", prefixItems: pair })).toBe(
      "[string?, (number | null)?, ...unknown[]]",
    );
    expect(
      ts({ type: "array", prefixItems: pair, minItems: 2, items: false }),
    ).toBe("[string, number | null]");
    expect(
      ts({ prefixItems: pair, minItems: 1, items: { type: "boolean" } }),
    ).toBe("[string, (number | null)?, ...boolean[]]");
    // Draft-07 form: items array + additionalItems
    expect(
      ts({ type: "array", items: pair, minItems: 2, additionalItems: false }),
    ).toBe("[string, number | null]");
  });

  test("type arrays keep sibling keywords per branch", () => {
    expect(ts({ type: ["array", "null"], items: { type: "string" } })).toBe(
      "string[] | null",
    );
  });

  test("objects: required, optional, quoted keys, docs", () => {
    const type = ts({
      type: "object",
      properties: {
        id: { type: "string", description: "The */ id" },
        "user-id": { type: "number" },
      },
      required: ["id", "extra"],
    });
    expect(type).toContain("/** The *\\/ id */\nid: string;");
    expect(type).toContain('"user-id"?: number;');
    expect(type).toContain("extra: unknown;");
  });

  test("index signatures admit declared property types", () => {
    const type = ts({
      type: "object",
      properties: { id: { type: "number" } },
      additionalProperties: { type: "string" },
    });
    expect(type).toContain("[key: string]: string | (number | undefined);");
  });

  test("objects without declared properties", () => {
    expect(ts({ type: "object" })).toBe("Record<string, unknown>");
    expect(ts({ type: "object", additionalProperties: false })).toBe(
      "Record<string, never>",
    );
    expect(
      ts({ type: "object", additionalProperties: { type: "string" } }),
    ).toBe("{\n[key: string]: string;\n}");
  });

  test("composition applies alongside type and groups operands", () => {
    expect(
      ts({
        type: "object",
        properties: { a: { type: "string" } },
        anyOf: [{ required: ["a"] }, {}],
      }),
    ).toBe("{\na?: string;\n}");
    expect(
      ts({
        allOf: [
          { anyOf: [{ type: "string" }, { type: "number" }] },
          { type: "string" },
        ],
      }),
    ).toBe("(string | number) & string");
  });

  test("resolves local refs and widens recursive ones", () => {
    const schema = {
      type: "object",
      properties: { id: { $ref: "#/$defs/Id" }, next: { $ref: "#" } },
      $defs: { Id: { type: "string" } },
    };
    const type = ts(schema);
    expect(type).toContain("id?: string;");
    expect(type).toContain("next?: {\nid?: string;\nnext?: unknown;\n};");
    expect(ts({ $ref: "https://example.com/schema" })).toBe("unknown");
  });

  test("names recursive refs instead of widening them", () => {
    const tree = {
      type: "object",
      properties: {
        children: { type: "array", items: { $ref: "#" } },
        first: { $ref: "#/$defs/Node" },
      },
      $defs: {
        Node: {
          type: "object",
          properties: { next: { $ref: "#/$defs/Node" } },
          required: ["next"],
        },
      },
    };
    const taken = new Set(["TreeNode"]); // e.g. another tool's type
    expect(schemaTypeAliases(tree, "Tree", taken)).toEqual([
      { name: "Tree", type: "{\nchildren?: Tree[];\nfirst?: TreeNode2;\n}" },
      { name: "TreeNode2", type: "{\nnext: TreeNode2;\n}" },
    ]);
    expect(taken).toContain("TreeNode2");
    // Without names, the cycle widens
    expect(ts(tree)).toContain("children?: {\nchildren?: unknown[];");
  });

  test("widens aliases TypeScript rejects as circular", () => {
    const aliases = (schema: object) =>
      schemaTypeAliases(schema, "A", new Set());
    const self = { $ref: "#" };
    const string = { type: "string" };
    const types = (schema: object) => aliases(schema).map((a) => a.type);

    expect(types({ anyOf: [self, string] })).toEqual(["unknown"]);
    // Parentheses don't defer: (A | string) & {...} is circular
    expect(
      types({ allOf: [{ anyOf: [self, string] }, { type: "object" }] }),
    ).toEqual(["unknown"]);
    // A tuple rest spreads eagerly
    expect(
      types({
        anyOf: [
          {
            type: "array",
            prefixItems: [],
            items: { type: "array", items: self },
          },
          string,
        ],
      }),
    ).toEqual(["unknown"]);
    // Mutual top-level references between named aliases
    const ref = (def: string) => ({ $ref: `#/$defs/${def}` });
    const mutual = aliases({
      type: "object",
      properties: { x: ref("P") },
      $defs: {
        P: ref("Q"),
        Q: { anyOf: [ref("P"), { type: "array", items: ref("Q") }] },
      },
    });
    expect(
      typecheck(
        mutual.map((a) => `export type ${a.name} = ${a.type};`).join("\n"),
      ),
    ).toEqual([]);

    // Recursion through arrays, tuples and objects is deferred: kept
    const kept = [
      types({ anyOf: [{ type: "array", items: self }, string] }),
      types({ type: "array", items: { anyOf: [self, string] } }),
      types({ type: "array", prefixItems: [self] }),
      types({ type: "object", additionalProperties: self }),
    ].flat();
    expect(kept).toEqual([
      "A[] | string",
      "(A | string)[]",
      "[A?, ...unknown[]]",
      "{\n[key: string]: A;\n}",
    ]);
  });

  test("scopes refs to the nearest $id and decodes pointers first", () => {
    const type = ts({
      type: "object",
      properties: {
        child: {
          $id: "child",
          type: "object",
          properties: { x: { $ref: "#/$defs/X" } },
          $defs: { X: { type: "string" } },
        },
        y: { $ref: "#/$defs/a%2F$defs%2Fb" },
      },
      $defs: {
        X: { type: "number" },
        a: { $defs: { b: { type: "boolean" } } },
      },
    });
    expect(type).toContain("x?: string;");
    expect(type).toContain("y?: boolean;");
  });

  test("patternProperties widen the index signature", () => {
    expect(
      ts({
        type: "object",
        patternProperties: { "^x": { type: "string" } },
        additionalProperties: false,
      }),
    ).toBe("{\n[key: string]: string;\n}");
    // Unmatched keys stay open unless additionalProperties says otherwise
    expect(
      ts({ type: "object", patternProperties: { "^x": { type: "string" } } }),
    ).toBe("{\n[key: string]: unknown;\n}");
  });

  test("an unsupported dialect constrains nothing", () => {
    // draft-04 has no `const`, and isn't one the SDK validates
    const draft04 = "http://json-schema.org/draft-04/schema#";
    expect(ts({ $schema: draft04, type: "number", const: 1 })).toBe("unknown");
    expect(
      ts({
        type: "object",
        properties: { a: { $ref: "#/$defs/a" } },
        required: ["a"],
        $defs: { a: { $id: "a", $schema: draft04, type: "string" } },
      }),
    ).toBe("{\na: unknown;\n}");
    expect(
      ts({
        $schema: "https://json-schema.org/draft/2020-12/schema#",
        const: 1,
      }),
    ).toBe("1");
  });
});

/** Every naming and escaping hazard the generator must survive. */
const tool = (name: string, extra: Partial<Tool> = {}): Tool => ({
  name,
  inputSchema: { type: "object" },
  ...extra,
});
const alpha: ServerSnapshot = {
  protocolVersion: "2026-07-28",
  protocolEra: "modern",
  authorized: false,
  capabilities: { tools: {}, prompts: {}, resources: {} },
  tools: [
    tool("get-user", {
      description: "Ends a comment */ early",
      inputSchema: {
        type: "object",
        properties: { "user-id": { type: "string" } },
        required: ["user-id"],
      },
    }),
    tool("get_user"),
    tool("move", {
      inputSchema: {
        type: "object",
        properties: {
          to: {
            type: "array",
            prefixItems: [{ type: "number" }, { type: "number" }],
            minItems: 2,
            items: false,
          },
        },
        minProperties: 1,
      },
    }),
    // Recursive input: a named alias, compiled by the typecheck below
    tool("tree", {
      inputSchema: {
        type: "object",
        properties: { node: { $ref: "#/$defs/Node" } },
        $defs: {
          Node: {
            type: "object",
            properties: {
              children: { type: "array", items: { $ref: "#/$defs/Node" } },
            },
          },
        },
      },
    }),
    tool("client"),
    tool("constructor"),
    tool("then"),
    tool('say"hi\\n'),
    // Its input type must not clash with search's output type
    tool("search_output"),
    tool("search", {
      outputSchema: {
        type: "object",
        properties: { total: { type: "number" } },
        required: ["total"],
      },
    }),
  ],
  resources: [],
  resourceTemplates: [
    {
      name: "issue",
      description: "An issue",
      uriTemplate: "repo://{owner}/{repo}/issues/{number}?v={1st}",
    },
    // Literal hazards in a template literal: backtick, backslash, `$` before `{`
    { name: "odd", uriTemplate: "x://a`b\\c$/{id}" },
    // RFC 6570 varnames may hold dots and pct-encoded octets
    { name: "user", uriTemplate: "u://{user.name}/{%69d}" },
    // Operators aren't expanded inline: readResource(uri) covers them
    { name: "search", uriTemplate: "search://{?q}" },
  ],
  prompts: [
    {
      name: "summarize",
      arguments: [{ name: "page-id", required: true }, { name: "tone" }],
    },
  ],
};

/** Tools only: no prompt or resource imports. */
const beta: ServerSnapshot = {
  protocolVersion: "2026-07-28",
  protocolEra: "modern",
  authorized: false,
  capabilities: { tools: {} },
  tools: [
    tool("search", {
      inputSchema: {
        type: "object",
        properties: { limit: { type: "number" } },
        required: ["limit"],
      },
    }),
  ],
  resources: [],
  resourceTemplates: [],
  prompts: [],
};

/** Strict typecheck of generated code against the real SDK types. */
function typecheck(code: string): string[] {
  const project = new Project({
    compilerOptions: {
      strict: true,
      noUnusedLocals: true,
      noEmit: true,
      skipLibCheck: true,
      target: ScriptTarget.ESNext,
      module: ModuleKind.Preserve,
      moduleResolution: ModuleResolutionKind.Bundler,
    },
  });
  // In src/ so the SDK import resolves from this package's node_modules
  const file = project.createSourceFile(
    resolve(import.meta.dir, "__generated__.ts"),
    code,
  );
  project.resolveSourceFileDependencies();
  return file
    .getPreEmitDiagnostics()
    .map((d) => d.getMessageText())
    .map((m) => (typeof m === "string" ? m : m.getMessageText()));
}

/** Import generated code as JS (type imports erased). */
async function load(code: string): Promise<Record<string, any>> {
  const js = ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ESNext,
    },
  }).outputText;
  const dir = await mkdtemp(join(tmpdir(), "mcg-"));
  try {
    await writeFile(join(dir, "client.mjs"), js);
    return await import(join(dir, "client.mjs"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("generateClientFile", () => {
  const code = generateClientFile("alpha", alpha);

  test("output typechecks strictly despite hostile names", () => {
    expect(typecheck(code)).toEqual([]);
  });

  test("typed results narrow on isError", () => {
    const usage = `
export async function use(alpha: AlphaClient) {
  const result = await alpha.search();
  // @ts-expect-error structuredContent is unknown until isError is ruled out
  result.structuredContent.total;
  if (!result.isError) return result.structuredContent.total satisfies number;
}`;
    expect(typecheck(code + usage)).toEqual([]);
  });

  test("imports only SDK types", () => {
    expect(code).not.toContain('mcp-client-gen"');
    expect(code).toMatch(
      /^import type \{[^}]+\} from "@modelcontextprotocol\/client";$/m,
    );
    expect(code.match(/^import /gm)).toHaveLength(1);
  });

  test("allocates collision-free member and type names", () => {
    expect(code).toContain(
      "getUser(input: GetUserInput, options?: CallToolRequestOptions)",
    );
    expect(code).toContain(
      "getUser2(input: GetUser2Input = {}, options?: CallToolRequestOptions)",
    );
    // minProperties rejects {}: no default
    expect(code).toContain(
      "move(input: MoveInput, options?: CallToolRequestOptions)",
    );
    expect(code).toContain("to?: [number, number];");
    expect(code).toContain("export type TreeInputNode = {");
    expect(code).toContain("children?: TreeInputNode[];");
    // Object-literal members: only `then` (thenable) and the generic reader are reserved
    expect(code).toContain("client(input: ClientInput");
    expect(code).toContain("constructor(input: ConstructorInput");
    expect(code).toContain("then2(input: Then2Input");
    expect(code).toContain("export type SearchOutput =");
    expect(code).toContain("export type SearchOutputInput =");
    expect(code).toContain(
      "export type AlphaClient = ReturnType<typeof createAlphaClient>;",
    );
  });

  test("documents a tool once, on its method", () => {
    expect(code.split("Ends a comment *\\/ early")).toHaveLength(2);
    expect(code).toContain("/** Arguments of the `get-user` tool. */");
  });

  test("strips the server name from tool names, per tool", () => {
    const tools = ["notion-search", "notion_fetch", "Notion-create-pages"].map(
      (name) => tool(name),
    );
    const module = generateClientFile("notion", { ...beta, tools });
    expect(module).toContain("search(input: SearchInput");
    expect(module).toContain("fetch(input: FetchInput");
    expect(module).toContain("createPages(input: CreatePagesInput");
    expect(module).toContain('name: "notion-search"'); // wire names unchanged

    // A new unprefixed tool renames nothing; one it collides with keeps its prefix
    const grown = generateClientFile("notion", {
      ...beta,
      tools: [...tools, tool("health"), tool("search")],
    });
    expect(grown).toContain("fetch(input: FetchInput");
    expect(grown).toContain("health(input: HealthInput");
    expect(grown).toContain("search(input: SearchInput");
    expect(grown).toContain("notionSearch(input: NotionSearchInput");
  });

  test("names don't depend on the listing order", () => {
    const tools = [tool("get_user"), tool("get-user"), tool("get.user")];
    const prompts = [{ name: "a-b" }, { name: "a_b" }];
    const names = (module: string) =>
      [...module.matchAll(/^\s*(\w+)\(.*\n.*name: "([^"]+)"/gm)].map(
        ([, method, wire]) => `${method}=${wire}`,
      );
    const forward = generateClientFile("x", {
      ...beta,
      capabilities: { tools: {}, prompts: {} },
      tools,
      prompts,
    });
    const reversed = generateClientFile("x", {
      ...beta,
      capabilities: { tools: {}, prompts: {} },
      tools: tools.toReversed(),
      prompts: prompts.toReversed(),
    });
    expect(names(forward).toSorted()).toEqual(names(reversed).toSorted());
    // Code-point order: `-` < `.` < `_`
    expect(names(forward)).toEqual([
      "getUser3=get_user",
      "getUser=get-user",
      "getUser2=get.user",
      "aBPrompt=a-b",
      "aBPrompt2=a_b",
    ]);
  });

  test("prompt methods: one Prompt suffix, duplicate arguments merged", () => {
    const module = generateClientFile("x", {
      ...beta,
      tools: [],
      capabilities: { prompts: {} },
      prompts: [
        {
          name: "summarize-prompt",
          arguments: [
            { name: "tone", required: true },
            { name: "tone" },
            { name: "page", required: true },
          ],
        },
      ],
    });
    expect(module).toContain(
      "summarizePrompt(args: { tone?: string; page: string; }",
    );
    expect(typecheck(module)).toEqual([]);
  });

  test("records the protocol revision in the header", () => {
    expect(code).toStartWith(
      "/* Generated by mcp-client-gen from MCP 2026-07-28.",
    );
  });

  test("rejects a client of the other era only when output types depend on it", () => {
    const stringOutput = tool("count", {
      outputSchema: { type: "number" } as never,
    });
    const modern = generateClientFile("x", { ...beta, tools: [stringOutput] });
    expect(modern).toContain('if (client.getProtocolEra() !== "modern") throw');
    expect(typecheck(modern)).toEqual([]);
    // Legacy snapshot: the SDK's `{ result }` wrapper
    const wrapped = tool("count", {
      outputSchema: {
        type: "object",
        properties: { result: { type: "number" } },
        required: ["result"],
      },
    });
    const legacy = generateClientFile("x", {
      ...beta,
      protocolVersion: "2025-11-25",
      protocolEra: "legacy",
      tools: [wrapped],
    });
    expect(legacy).toContain('if (client.getProtocolEra() !== "legacy") throw');
    // Object outputs look the same in both eras
    expect(code).not.toContain("getProtocolEra");
  });

  test("escapes wire names, keys and comments", () => {
    expect(code).toContain('name: "say\\"hi\\\\n"');
    expect(code).toContain('"page-id": string');
    expect(code).toContain("Ends a comment *\\/ early");
  });

  test("is deterministic", () => {
    expect(generateClientFile("alpha", alpha)).toBe(code);
  });

  test("reads simple resource templates with typed parameters", () => {
    expect(code).toContain(
      'readIssue(params: { owner: string; repo: string; number: string; "1st": string; }, options?: RequestOptions)',
    );
    expect(code).toContain(
      'readUser(params: { "user.name": string; "%69d": string; }',
    );
    expect(code).not.toContain("readSearch(");
  });

  test("emits resource readers and imports only where used", () => {
    expect(code).toContain(
      "readResource(uri: string, options?: RequestOptions): Promise<ReadResourceResult>",
    );
    const onlyBeta = generateClientFile("beta", beta);
    for (const unused of [
      "readResource",
      "ReadResourceResult",
      "GetPromptResult",
      /\bRequestOptions\b/,
      "ToolResult<",
    ])
      expect(onlyBeta).not.toMatch(unused);
    expect(typecheck(onlyBeta)).toEqual([]);
  });
});

describe("generated client at runtime", () => {
  /** Fake SDK client that returns canned results and records calls. */
  const fakeClient = (results: Record<string, unknown>) => {
    const calls: unknown[] = [];
    const respond =
      (method: string) => async (params: unknown, options?: unknown) => {
        calls.push(options ? { method, params, options } : { method, params });
        return results[method];
      };
    const client = {
      callTool: respond("callTool"),
      readResource: respond("readResource"),
      getPrompt: respond("getPrompt"),
    };
    return { client, calls };
  };

  test("tools return the SDK result unchanged, errors included", async () => {
    const mod = await load(code());
    const structured = {
      content: [{ type: "text", text: "kept" }],
      structuredContent: { total: 3 },
    };
    expect(
      await mod
        .createAlphaClient(fakeClient({ callTool: structured }).client)
        .search(),
    ).toEqual(structured);

    const failed = { isError: true, content: [{ type: "text", text: "boom" }] };
    const { client, calls } = fakeClient({ callTool: failed });
    const options = { timeout: 5 };
    expect(
      await mod.createAlphaClient(client).getUser({ "user-id": "1" }, options),
    ).toEqual(failed);
    expect(calls).toEqual([
      {
        method: "callTool",
        params: { name: "get-user", arguments: { "user-id": "1" } },
        options,
      },
    ]);
  });

  test("resources and prompts return the SDK result; prompts pass arguments", async () => {
    const mod = await load(code());
    const read = {
      contents: [
        { uri: "file:///a", text: "a" },
        { uri: "file:///a", blob: "AA==" },
      ],
    };
    const prompt = {
      description: "kept",
      messages: [{ role: "user", content: { type: "text", text: "hi" } }],
    };
    const { client, calls } = fakeClient({
      readResource: read,
      getPrompt: prompt,
    });
    const alpha = mod.createAlphaClient(client);
    expect(await alpha.readResource("file:///a")).toEqual(read);
    expect(await alpha.summarizePrompt({ "page-id": "p1" })).toEqual(prompt);
    expect(calls.at(-1)).toEqual({
      method: "getPrompt",
      params: { name: "summarize", arguments: { "page-id": "p1" } },
    });

    await alpha.readIssue({
      owner: "a b",
      repo: "r/x",
      number: "1",
      "1st": "?",
    });
    await alpha.readOdd({ id: "7" });
    expect(calls.slice(-2)).toEqual([
      {
        method: "readResource",
        params: { uri: "repo://a%20b/r%2Fx/issues/1?v=%3F" },
      },
      { method: "readResource", params: { uri: "x://a`b\\c$/7" } },
    ]);
  });

  test("reserves members JavaScript calls implicitly", async () => {
    const mod = await load(
      generateClientFile("x", {
        ...beta,
        tools: [tool("toJSON"), tool("then")],
      }),
    );
    const { client, calls } = fakeClient({});
    const x = mod.createXClient(client);
    expect(JSON.stringify(x)).toBe("{}"); // no tool call
    expect(await x).toBe(x); // not a thenable
    expect(calls).toEqual([]);
    expect(Object.keys(x)).toEqual(["toJSON2", "then2"]);
  });

  test("an era-bound client rejects a client of the other era", async () => {
    const mod = await load(
      generateClientFile("x", {
        ...beta,
        tools: [tool("count", { outputSchema: { type: "number" } as never })],
      }),
    );
    const client = (era?: string) => ({ getProtocolEra: () => era });
    expect(() => mod.createXClient(client("legacy"))).toThrow(
      'createXClient: generated for MCP 2026-07-28 (modern era); connect the Client with versionNegotiation: { mode: "auto" }',
    );
    expect(mod.createXClient(client("modern")).count).toBeFunction();
  });

  const code = () => generateClientFile("alpha", alpha);
});

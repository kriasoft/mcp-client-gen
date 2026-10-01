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
} from "./codegen/index.js";
import type { IntrospectionSuccess } from "./introspection.js";
import { extractServerName } from "./pipeline.js";

describe("extractServerName", () => {
  test("uses explicit name when provided", () => {
    expect(
      extractServerName(
        { type: "http", url: "https://example.com", name: "myServer" },
        0,
      ),
    ).toBe("myServer");
  });

  test("extracts domain name from URL", () => {
    expect(
      extractServerName({ type: "http", url: "https://notion.com/mcp" }, 0),
    ).toBe("notion");
    expect(
      extractServerName(
        { type: "http", url: "https://api.github.com/v1/mcp" },
        0,
      ),
    ).toBe("github");
  });

  test("handles subdomains correctly", () => {
    expect(
      extractServerName({ type: "http", url: "https://api.notion.com" }, 0),
    ).toBe("notion");
    expect(
      extractServerName({ type: "http", url: "https://www.example.com" }, 0),
    ).toBe("example");
  });

  test("falls back to path segment", () => {
    expect(
      extractServerName({ type: "http", url: "https://api.com/notion/v1" }, 0),
    ).toBe("notion");
  });

  test("ignores IP and localhost hosts", () => {
    const name = (url: string) => extractServerName({ type: "http", url }, 0);
    expect(name("http://127.0.0.1:8080/mcp")).toBe("server1");
    expect(name("http://localhost:3000/github")).toBe("github");
    expect(name("http://[::1]:3000/mcp")).toBe("server1");
  });

  test("falls back to index for unresolvable URLs", () => {
    expect(extractServerName({ type: "http", url: "https://api.com" }, 0)).toBe(
      "server1",
    );
    expect(extractServerName({ type: "http", url: "invalid-url" }, 5)).toBe(
      "server6",
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
  });
});

/** Every naming and escaping hazard the generator must survive, on two servers. */
const tool = (name: string, extra: Partial<Tool> = {}): Tool => ({
  name,
  inputSchema: { type: "object" },
  ...extra,
});
const edgeCases = new Map<string, IntrospectionSuccess>([
  [
    "alpha",
    {
      ok: true,
      server: { type: "http", url: "https://alpha.test/mcp" },
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
        tool("client"),
        tool("constructor"),
        tool("then"),
        tool('say"hi\\n'),
        tool("search", {
          outputSchema: {
            type: "object",
            properties: { total: { type: "number" } },
            required: ["total"],
          },
        }),
      ],
      resources: [],
      prompts: [
        {
          name: "summarize",
          arguments: [{ name: "page-id", required: true }, { name: "tone" }],
        },
      ],
    },
  ],
  [
    "beta",
    {
      ok: true,
      server: { type: "http", url: "https://beta.test/mcp" },
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
      prompts: [],
    },
  ],
]);

/** Strict typecheck of generated code against the real SDK types. */
function typecheck(code: string): string[] {
  const project = new Project({
    compilerOptions: {
      strict: true,
      noUnusedLocals: true,
      // Resolve to source: package exports point at dist, absent before a build
      paths: { "mcp-client-gen": [resolve(import.meta.dir, "index.ts")] },
      noEmit: true,
      skipLibCheck: true,
      target: ScriptTarget.ESNext,
      module: ModuleKind.Preserve,
      moduleResolution: ModuleResolutionKind.Bundler,
    },
  });
  // In src/ so imports resolve from this package (incl. its "mcp-client-gen" self-reference)
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
  const { code, exports } = generateClientFile(edgeCases);

  test("output typechecks strictly despite hostile names", () => {
    expect(typecheck(code)).toEqual([]);
  });

  test("allocates collision-free member and type names", () => {
    expect(code).toContain(
      "async getUser(input: GetUserInput, options?: RequestOptions)",
    );
    expect(code).toContain(
      "async getUser2(input: GetUser2Input = {}, options?: RequestOptions)",
    );
    // minProperties rejects {}: no default
    expect(code).toContain(
      "async move(input: MoveInput, options?: RequestOptions)",
    );
    expect(code).toContain("to?: [number, number];");
    expect(code).toContain("async client2(");
    expect(code).toContain("async constructor2(");
    expect(code).toContain("async then2(");
    // Same tool on two servers: the second server's types get its prefix
    expect(code).toContain("export type SearchInput =");
    expect(code).toContain("export type BetaSearchInput =");
    expect(exports).toEqual(["createAlphaClient", "createBetaClient"]);
  });

  test("escapes wire names, keys and comments", () => {
    expect(code).toContain('name: "say\\"hi\\\\n"');
    expect(code).toContain('"page-id": string');
    expect(code).toContain("Ends a comment *\\/ early");
  });

  test("is deterministic", () => {
    expect(generateClientFile(edgeCases).code).toBe(code);
  });

  test("rejects servers whose names map to the same class", () => {
    const servers = new Map([
      ["foo-bar", edgeCases.get("beta")!],
      ["foo_bar", edgeCases.get("beta")!],
    ]);
    expect(() => generateClientFile(servers)).toThrow(
      'Servers "foo-bar" and "foo_bar" both generate FooBarClient',
    );
  });

  test("emits resource readers only for servers with resources", () => {
    expect(code).toContain(
      "async readResource(uri: string, options?: RequestOptions)",
    );
    const onlyBeta = generateClientFile(
      new Map([["beta", edgeCases.get("beta")!]]),
    ).code;
    expect(onlyBeta).not.toContain("readResource");
    expect(onlyBeta).not.toContain("ReadResourceResult");
    expect(typecheck(onlyBeta)).toEqual([]);
  });
});

describe("generated client at runtime", () => {
  /** Fake connection whose client returns canned results and records calls. */
  const fakeConnection = (results: Record<string, unknown>) => {
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
    return { connection: { client }, calls };
  };

  test("typed tools return structuredContent; untyped return the whole result", async () => {
    const mod = await load(generateClientFile(edgeCases).code);
    const structured = {
      content: [{ type: "text", text: "ignored" }],
      structuredContent: { total: 3 },
    };
    const alpha = mod.createAlphaClient(
      fakeConnection({ callTool: structured }).connection,
    );
    expect(await alpha.search()).toEqual({ total: 3 });

    const multi = {
      content: [
        { type: "text", text: "a" },
        { type: "image", data: "AA==", mimeType: "image/png" },
      ],
    };
    const { connection, calls } = fakeConnection({ callTool: multi });
    const options = { timeout: 5 };
    expect(
      await mod
        .createAlphaClient(connection)
        .getUser({ "user-id": "1" }, options),
    ).toEqual(multi);
    expect(calls).toEqual([
      {
        method: "callTool",
        params: { name: "get-user", arguments: { "user-id": "1" } },
        options,
      },
    ]);
  });

  test("tool errors throw with their text; missing structured content throws", async () => {
    const mod = await load(generateClientFile(edgeCases).code);
    const failing = mod.createAlphaClient(
      fakeConnection({
        callTool: { isError: true, content: [{ type: "text", text: "boom" }] },
      }).connection,
    );
    await expect(failing.getUser2()).rejects.toThrow(
      "Tool 'get_user' failed: boom",
    );

    const empty = mod.createAlphaClient(
      fakeConnection({ callTool: { content: [] } }).connection,
    );
    await expect(empty.search()).rejects.toThrow(
      "Tool 'search' returned no structured content",
    );
    expect(await empty.getUser2()).toEqual({ content: [] });
  });

  test("resources return every content entry; prompts pass arguments", async () => {
    const mod = await load(generateClientFile(edgeCases).code);
    const contents = [
      { uri: "file:///a", text: "a" },
      { uri: "file:///a", blob: "AA==" },
    ];
    const { connection, calls } = fakeConnection({
      readResource: { contents },
      getPrompt: {
        messages: [{ role: "user", content: { type: "text", text: "hi" } }],
      },
    });
    const alpha = mod.createAlphaClient(connection);
    expect(await alpha.readResource("file:///a")).toEqual(contents);
    expect(await alpha.summarizePrompt({ "page-id": "p1" })).toHaveLength(1);
    expect(calls.at(-1)).toEqual({
      method: "getPrompt",
      params: { name: "summarize", arguments: { "page-id": "p1" } },
    });
  });
});

describe("generated Notion client", () => {
  // Real fixture + real SDK types: catches SDK type drift that string assertions can't
  test("typechecks against @modelcontextprotocol/client", async () => {
    const fixture = await Bun.file(
      resolve(import.meta.dir, "../test/fixtures/notion/introspection.json"),
    ).json();
    const { code } = generateClientFile(new Map([["notion", fixture]]));
    expect(typecheck(code)).toEqual([]);
  });
});

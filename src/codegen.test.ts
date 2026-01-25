/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, test } from "bun:test";
import { Project } from "ts-morph";
import {
  camelCase,
  generateClientClass,
  generateClientFile,
  generateToolInterface,
  generateToolOutputInterface,
  hasOutputSchema,
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

  test("falls back to index for unresolvable URLs", () => {
    expect(extractServerName({ type: "http", url: "https://api.com" }, 0)).toBe(
      "server1",
    );
    expect(extractServerName({ type: "http", url: "invalid-url" }, 5)).toBe(
      "server6",
    );
  });
});

describe("pascalCase", () => {
  test("converts hyphenated strings", () => {
    expect(pascalCase("create-page")).toBe("CreatePage");
    expect(pascalCase("my-api-client")).toBe("MyApiClient");
  });

  test("converts underscored strings", () => {
    expect(pascalCase("create_page")).toBe("CreatePage");
  });

  test("handles strings starting with digits", () => {
    expect(pascalCase("123api")).toBe("_123api");
    expect(pascalCase("42")).toBe("_42");
  });

  test("handles empty and whitespace strings", () => {
    expect(pascalCase("")).toBe("Unknown");
    expect(pascalCase("   ")).toBe("Unknown");
    expect(pascalCase("---")).toBe("Unknown");
  });

  test("escapes reserved words", () => {
    expect(pascalCase("delete")).toBe("_Delete");
    expect(pascalCase("class")).toBe("_Class");
    expect(pascalCase("default")).toBe("_Default");
  });

  test("strips non-alphanumeric characters", () => {
    expect(pascalCase("hello@world")).toBe("HelloWorld");
    expect(pascalCase("foo.bar.baz")).toBe("FooBarBaz");
  });
});

describe("camelCase", () => {
  test("converts hyphenated strings", () => {
    expect(camelCase("create-page")).toBe("createPage");
    expect(camelCase("my-api-client")).toBe("myApiClient");
  });

  test("handles strings starting with digits", () => {
    expect(camelCase("123api")).toBe("_123api");
  });

  test("handles empty strings", () => {
    expect(camelCase("")).toBe("unknown");
  });

  test("escapes reserved words", () => {
    expect(camelCase("delete")).toBe("_delete");
    expect(camelCase("class")).toBe("_class");
    expect(camelCase("default")).toBe("_default");
  });
});

describe("codegen", () => {
  describe("jsonSchemaToTypeScript", () => {
    test("converts primitive types", () => {
      expect(jsonSchemaToTypeScript({ type: "string" })).toBe("string");
      expect(jsonSchemaToTypeScript({ type: "number" })).toBe("number");
      expect(jsonSchemaToTypeScript({ type: "integer" })).toBe("number");
      expect(jsonSchemaToTypeScript({ type: "boolean" })).toBe("boolean");
      expect(jsonSchemaToTypeScript({ type: "null" })).toBe("null");
    });

    test("converts string enums", () => {
      const schema = {
        type: "string",
        enum: ["draft", "published", "archived"],
      };
      expect(jsonSchemaToTypeScript(schema)).toBe(
        '"draft" | "published" | "archived"',
      );
    });

    test("converts arrays", () => {
      expect(
        jsonSchemaToTypeScript({
          type: "array",
          items: { type: "string" },
        }),
      ).toBe("string[]");

      expect(
        jsonSchemaToTypeScript({
          type: "array",
          items: { type: "number" },
        }),
      ).toBe("number[]");
    });

    test("converts simple objects", () => {
      const schema = {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
        required: ["name"],
      };

      const result = jsonSchemaToTypeScript(schema);
      expect(result).toContain("name: string;");
      expect(result).toContain("age?: number;");
    });

    test("converts nested objects", () => {
      const schema = {
        type: "object",
        properties: {
          user: {
            type: "object",
            properties: {
              id: { type: "string" },
              profile: {
                type: "object",
                properties: {
                  bio: { type: "string" },
                },
              },
            },
            required: ["id"],
          },
        },
      };

      const result = jsonSchemaToTypeScript(schema);
      expect(result).toContain("user?:");
      expect(result).toContain("id: string;");
      expect(result).toContain("profile?:");
    });

    test("handles additional properties", () => {
      const schema = {
        type: "object",
        properties: {
          known: { type: "string" },
        },
        additionalProperties: { type: "number" },
      };

      const result = jsonSchemaToTypeScript(schema);
      expect(result).toContain("known?: string;");
      expect(result).toContain("[key: string]: number;");
    });

    test("converts union types", () => {
      expect(jsonSchemaToTypeScript({ type: ["string", "number"] })).toBe(
        "string | number",
      );
    });

    test("converts anyOf schemas", () => {
      const schema = {
        anyOf: [{ type: "string" }, { type: "number" }],
      };
      expect(jsonSchemaToTypeScript(schema)).toBe("string | number");
    });

    test("converts allOf schemas", () => {
      const schema = {
        allOf: [
          {
            type: "object",
            properties: { a: { type: "string" } },
          },
          {
            type: "object",
            properties: { b: { type: "number" } },
          },
        ],
      };
      const result = jsonSchemaToTypeScript(schema);
      expect(result).toContain("&");
    });

    test("handles undefined schema", () => {
      expect(jsonSchemaToTypeScript(undefined)).toBe("unknown");
      expect(jsonSchemaToTypeScript(null)).toBe("unknown");
    });

    test("handles objects without properties", () => {
      expect(jsonSchemaToTypeScript({ type: "object" })).toBe(
        "Record<string, unknown>",
      );
    });

    test("quotes property names with special characters", () => {
      const schema = {
        type: "object",
        properties: {
          "content-type": { type: "string" },
          "x-api-key": { type: "string" },
        },
      };

      const result = jsonSchemaToTypeScript(schema);
      expect(result).toContain('"content-type"?: string;');
      expect(result).toContain('"x-api-key"?: string;');
    });
  });

  describe("generateToolInterface", () => {
    test("generates interface for tool with object schema", () => {
      const project = new Project({ useInMemoryFileSystem: true });
      const sourceFile = project.createSourceFile("test.ts");

      const tool: Tool = {
        name: "create-page",
        description: "Create a new page",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string", description: "Page title" },
            content: { type: "string" },
            published: { type: "boolean" },
          },
          required: ["title"],
        },
      };

      const interfaceDecl = generateToolInterface(sourceFile, tool);

      expect(interfaceDecl.getName()).toBe("CreatePageInput");
      expect(interfaceDecl.isExported()).toBe(true);

      const properties = interfaceDecl.getProperties();
      expect(properties).toHaveLength(3);

      const titleProp = interfaceDecl.getProperty("title");
      expect(titleProp?.hasQuestionToken()).toBe(false);
      expect(titleProp?.getType().getText()).toContain("string");

      const contentProp = interfaceDecl.getProperty("content");
      expect(contentProp?.hasQuestionToken()).toBe(true);
    });

    test("generates interface for tool without schema", () => {
      const project = new Project({ useInMemoryFileSystem: true });
      const sourceFile = project.createSourceFile("test.ts");

      const tool: Tool = {
        name: "get-status",
        description: "Get system status",
        inputSchema: undefined as any,
      };

      const interfaceDecl = generateToolInterface(sourceFile, tool);
      expect(interfaceDecl.getName()).toBe("GetStatusInput");
    });

    test("adds JSDoc comments", () => {
      const project = new Project({ useInMemoryFileSystem: true });
      const sourceFile = project.createSourceFile("test.ts");

      const tool: Tool = {
        name: "test-tool",
        description: "This is a test tool",
        inputSchema: {
          type: "object",
          properties: {
            field: { type: "string", description: "Field description" },
          },
        },
      };

      const interfaceDecl = generateToolInterface(sourceFile, tool);
      const jsDocs = interfaceDecl.getJsDocs();
      expect(jsDocs).toHaveLength(1);
      expect(jsDocs[0]?.getDescription()).toBe("This is a test tool");

      const fieldProp = interfaceDecl.getProperty("field");
      const fieldDocs = fieldProp?.getJsDocs();
      expect(fieldDocs?.[0]?.getDescription()).toBe("Field description");
    });
  });

  describe("generateToolOutputInterface", () => {
    test("returns undefined when tool has no outputSchema", () => {
      const project = new Project({ useInMemoryFileSystem: true });
      const sourceFile = project.createSourceFile("test.ts");

      const tool: Tool = {
        name: "search",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
        },
      };

      const result = generateToolOutputInterface(sourceFile, tool);
      expect(result).toBeUndefined();
    });

    test("generates interface when tool has outputSchema", () => {
      const project = new Project({ useInMemoryFileSystem: true });
      const sourceFile = project.createSourceFile("test.ts");

      const tool: Tool = {
        name: "search",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
        },
      } as Tool;

      // Add outputSchema (MCP spec optional field)
      (tool as any).outputSchema = {
        type: "object",
        properties: {
          results: { type: "array", items: { type: "string" } },
          count: { type: "number", description: "Total results" },
        },
        required: ["results"],
      };

      const interfaceDecl = generateToolOutputInterface(sourceFile, tool);

      expect(interfaceDecl).toBeDefined();
      expect(interfaceDecl!.getName()).toBe("SearchOutput");
      expect(interfaceDecl!.isExported()).toBe(true);

      const resultsProp = interfaceDecl!.getProperty("results");
      expect(resultsProp?.hasQuestionToken()).toBe(false);

      const countProp = interfaceDecl!.getProperty("count");
      expect(countProp?.hasQuestionToken()).toBe(true);
      expect(countProp?.getJsDocs()[0]?.getDescription()).toBe("Total results");
    });
  });

  describe("hasOutputSchema", () => {
    test("returns false for tool without outputSchema", () => {
      const tool: Tool = {
        name: "test",
        inputSchema: { type: "object" },
      };
      expect(hasOutputSchema(tool)).toBe(false);
    });

    test("returns true for tool with outputSchema", () => {
      const tool: Tool = {
        name: "test",
        inputSchema: { type: "object" },
      } as Tool;
      (tool as any).outputSchema = { type: "object" };
      expect(hasOutputSchema(tool)).toBe(true);
    });
  });

  describe("generateClientClass", () => {
    test("generates class with tools, resources, and prompts", () => {
      const project = new Project({ useInMemoryFileSystem: true });
      const sourceFile = project.createSourceFile("test.ts");

      const result: IntrospectionSuccess = {
        ok: true,
        server: { type: "http", url: "http://example.com" },
        capabilities: {},
        tools: [
          {
            name: "create-item",
            description: "Create an item",
            inputSchema: {
              type: "object",
              properties: {
                name: { type: "string" },
              },
              required: ["name"],
            },
          },
          {
            name: "delete-item",
            inputSchema: {
              type: "object",
              properties: {
                id: { type: "string" },
              },
            },
          },
        ],
        resources: [
          {
            uri: "resource://items",
            name: "items",
            description: "List of items",
          },
        ],
        prompts: [
          {
            name: "generate-summary",
            description: "Generate a summary",
            arguments: [
              {
                name: "text",
                required: true,
              },
            ],
          },
        ],
      };

      const classDecl = generateClientClass(sourceFile, "test", result);

      expect(classDecl.getName()).toBe("TestClient");
      expect(classDecl.isExported()).toBe(true);

      // Check constructor
      const constructor = classDecl.getConstructors()[0];
      expect(constructor).toBeDefined();
      expect(constructor?.getParameters()).toHaveLength(1);

      // Check tool methods
      const createMethod = classDecl.getMethod("createItem");
      expect(createMethod).toBeDefined();
      expect(createMethod?.isAsync()).toBe(true);
      expect(createMethod?.getParameters()).toHaveLength(1);

      const deleteMethod = classDecl.getMethod("deleteItem");
      expect(deleteMethod).toBeDefined();

      // Check resource methods
      const getResourceMethod = classDecl.getMethod("getResource");
      expect(getResourceMethod).toBeDefined();

      const getItemsMethod = classDecl.getMethod("getItems");
      expect(getItemsMethod).toBeDefined();

      // Check prompt methods
      const promptMethod = classDecl.getMethod("generateSummaryPrompt");
      expect(promptMethod).toBeDefined();
    });

    test("generates typed return types for resources and prompts", () => {
      const project = new Project({ useInMemoryFileSystem: true });
      const sourceFile = project.createSourceFile("test.ts");

      const result: IntrospectionSuccess = {
        ok: true,
        server: { type: "http", url: "http://example.com" },
        capabilities: {},
        tools: [],
        resources: [
          {
            uri: "resource://config",
            name: "config",
            description: "Configuration",
          },
        ],
        prompts: [
          {
            name: "greeting",
            description: "A greeting prompt",
          },
        ],
      };

      const classDecl = generateClientClass(sourceFile, "typed", result);

      // Resource methods should return Promise<TextResourceContents | BlobResourceContents>
      const getResourceMethod = classDecl.getMethod("getResource");
      const resourceReturnType =
        getResourceMethod?.getReturnTypeNode()?.getText() ?? "";
      expect(resourceReturnType).toContain("TextResourceContents");
      expect(resourceReturnType).toContain("BlobResourceContents");

      const getConfigMethod = classDecl.getMethod("getConfig");
      const configReturnType =
        getConfigMethod?.getReturnTypeNode()?.getText() ?? "";
      expect(configReturnType).toContain("TextResourceContents");

      // Prompt methods should return Promise<PromptMessage[]>
      const promptMethod = classDecl.getMethod("greetingPrompt");
      const promptReturnType =
        promptMethod?.getReturnTypeNode()?.getText() ?? "";
      expect(promptReturnType).toContain("PromptMessage");
    });

    test("uses output type when tool has outputSchema", () => {
      const project = new Project({ useInMemoryFileSystem: true });
      const sourceFile = project.createSourceFile("test.ts");

      const toolWithOutput: Tool = {
        name: "search",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      } as Tool;
      (toolWithOutput as any).outputSchema = {
        type: "object",
        properties: { results: { type: "array", items: { type: "string" } } },
      };

      const result: IntrospectionSuccess = {
        ok: true,
        server: { type: "http", url: "http://example.com" },
        capabilities: {},
        tools: [toolWithOutput],
        resources: [],
        prompts: [],
      };

      const classDecl = generateClientClass(sourceFile, "test", result);

      const searchMethod = classDecl.getMethod("search");
      expect(searchMethod).toBeDefined();

      const returnType = searchMethod?.getReturnTypeNode()?.getText() ?? "";
      expect(returnType).toBe("Promise<SearchOutput>");
    });

    test("handles empty tools, resources, and prompts", () => {
      const project = new Project({ useInMemoryFileSystem: true });
      const sourceFile = project.createSourceFile("test.ts");

      const result: IntrospectionSuccess = {
        ok: true,
        server: { type: "http", url: "http://example.com" },
        capabilities: {},
        tools: [],
        resources: [],
        prompts: [],
      };

      const classDecl = generateClientClass(sourceFile, "empty", result);

      expect(classDecl.getName()).toBe("EmptyClient");

      // Should still have constructor and connection property
      expect(classDecl.getConstructors()).toHaveLength(1);
      expect(classDecl.getProperty("connection")).toBeDefined();

      // Should have client getter for advanced operations
      const clientGetter = classDecl.getGetAccessor("client");
      expect(clientGetter).toBeDefined();
      expect(clientGetter?.getReturnTypeNode()?.getText()).toBe("Client");

      // No tool/resource/prompt methods
      const methods = classDecl.getMethods();
      expect(methods).toHaveLength(0);
    });
  });

  describe("generateClientFile", () => {
    test("generates complete client file for multiple servers", () => {
      const servers = new Map<string, IntrospectionSuccess>([
        [
          "notion",
          {
            ok: true,
            server: { type: "http", url: "http://notion.example.com" },
            capabilities: {},
            tools: [
              {
                name: "create-page",
                description: "Create a page",
                inputSchema: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                  },
                  required: ["title"],
                },
              },
            ],
            resources: [],
            prompts: [],
          },
        ],
        [
          "github",
          {
            ok: true,
            server: { type: "http", url: "http://github.example.com" },
            capabilities: {},
            tools: [
              {
                name: "create-issue",
                inputSchema: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    body: { type: "string" },
                  },
                  required: ["title"],
                },
              },
            ],
            resources: [],
            prompts: [],
          },
        ],
      ]);

      const result = generateClientFile(servers, { treeShakable: true });
      const code = result.code;

      // Check imports
      expect(code).toContain(
        'import { Client } from "@modelcontextprotocol/sdk/client/index.js"',
      );
      expect(code).toContain(
        'import type { BlobResourceContents, PromptMessage, TextResourceContents } from "@modelcontextprotocol/sdk/types.js"',
      );
      expect(code).toContain(
        'import type { McpConnection } from "mcp-client-gen"',
      );

      // Check interfaces
      expect(code).toContain("export interface CreatePageInput");
      expect(code).toContain("export interface CreateIssueInput");

      // Check classes
      expect(code).toContain("export class NotionClient");
      expect(code).toContain("export class GithubClient");

      // Check methods
      expect(code).toContain("async createPage(input: CreatePageInput)");
      expect(code).toContain("async createIssue(input: CreateIssueInput)");

      // Check factory functions and exports metadata
      expect(code).toContain("export function createNotionClient");
      expect(code).toContain("export function createGithubClient");
      expect(result.exports).toEqual([
        "createNotionClient",
        "createGithubClient",
      ]);

      // Check formatting
      expect(code).toContain("/* Generated MCP Client SDK */");
      expect(code.split("\n").length).toBeGreaterThan(50);
    });

    test("generates non-tree-shakable exports", () => {
      const servers = new Map<string, IntrospectionSuccess>([
        [
          "test",
          {
            ok: true,
            server: { type: "http", url: "http://test.example.com" },
            capabilities: {},
            tools: [],
            resources: [],
            prompts: [],
          },
        ],
      ]);

      const result = generateClientFile(servers, { treeShakable: false });

      expect(result.code).toContain("export class TestClient");
      expect(result.code).not.toContain("export function createTestClient");
      expect(result.exports).toEqual([]);
    });

    test("generates deterministic output (no timestamps)", () => {
      const servers = new Map<string, IntrospectionSuccess>([
        [
          "test",
          {
            ok: true,
            server: { type: "http", url: "http://test.example.com" },
            capabilities: {},
            tools: [
              {
                name: "ping",
                inputSchema: { type: "object" },
              },
            ],
            resources: [],
            prompts: [],
          },
        ],
      ]);

      const result1 = generateClientFile(servers);
      const result2 = generateClientFile(servers);

      expect(result1.code).toBe(result2.code);
      expect(result1.code).not.toContain("Generated at:");
      expect(result1.code).not.toContain("@generated");
    });
  });
});

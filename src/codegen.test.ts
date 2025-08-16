/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test";
import { Project } from "ts-morph";
import type {
  Tool,
  Resource,
  Prompt,
} from "@modelcontextprotocol/sdk/types.js";
import type { IntrospectionResult } from "./introspection.js";
import {
  jsonSchemaToTypeScript,
  generateToolInterface,
  generateClientClass,
  generateClientFile,
} from "./codegen/index.js";

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
      expect(jsonSchemaToTypeScript(undefined)).toBe("any");
      expect(jsonSchemaToTypeScript(null)).toBe("any");
    });

    test("handles objects without properties", () => {
      expect(jsonSchemaToTypeScript({ type: "object" })).toBe(
        "Record<string, any>",
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

  describe("generateClientClass", () => {
    test("generates class with tools, resources, and prompts", () => {
      const project = new Project({ useInMemoryFileSystem: true });
      const sourceFile = project.createSourceFile("test.ts");

      const result: IntrospectionResult = {
        server: { type: "http", url: "http://example.com" },
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

    test("handles empty tools, resources, and prompts", () => {
      const project = new Project({ useInMemoryFileSystem: true });
      const sourceFile = project.createSourceFile("test.ts");

      const result: IntrospectionResult = {
        server: { type: "http", url: "http://example.com" },
        tools: [],
        resources: [],
        prompts: [],
      };

      const classDecl = generateClientClass(sourceFile, "empty", result);

      expect(classDecl.getName()).toBe("EmptyClient");

      // Should still have constructor and connection property
      expect(classDecl.getConstructors()).toHaveLength(1);
      expect(classDecl.getProperty("connection")).toBeDefined();

      // No tool/resource/prompt methods
      const methods = classDecl.getMethods();
      expect(methods).toHaveLength(0);
    });
  });

  describe("generateClientFile", () => {
    test("generates complete client file for multiple servers", () => {
      const servers = new Map<string, IntrospectionResult>([
        [
          "notion",
          {
            server: { type: "http", url: "http://notion.example.com" },
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
            server: { type: "http", url: "http://github.example.com" },
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

      const code = generateClientFile(servers, { treeShakable: true });

      // Check imports
      expect(code).toContain(
        'import { Client } from "@modelcontextprotocol/sdk/client/index.js"',
      );
      expect(code).toContain('import type { McpConnection } from "./types.js"');

      // Check interfaces
      expect(code).toContain("export interface CreatePageInput");
      expect(code).toContain("export interface CreateIssueInput");

      // Check classes
      expect(code).toContain("export class NotionClient");
      expect(code).toContain("export class GithubClient");

      // Check methods
      expect(code).toContain("async createPage(input: CreatePageInput)");
      expect(code).toContain("async createIssue(input: CreateIssueInput)");

      // Check singleton functions
      expect(code).toContain("export function getNotionClient");
      expect(code).toContain("export function getGithubClient");

      // Check formatting
      expect(code).toContain("/* Generated MCP Client SDK */");
      expect(code.split("\n").length).toBeGreaterThan(50);
    });

    test("handles server with introspection error", () => {
      const servers = new Map<string, IntrospectionResult>([
        [
          "broken",
          {
            server: { type: "http", url: "http://broken.example.com" },
            tools: [],
            resources: [],
            prompts: [],
            error: "Connection refused",
          },
        ],
      ]);

      const code = generateClientFile(servers);

      expect(code).toContain(
        "// Error introspecting broken: Connection refused",
      );
      expect(code).not.toContain("export class BrokenClient");
    });

    test("generates non-tree-shakable exports", () => {
      const servers = new Map<string, IntrospectionResult>([
        [
          "test",
          {
            server: { type: "http", url: "http://test.example.com" },
            tools: [],
            resources: [],
            prompts: [],
          },
        ],
      ]);

      const code = generateClientFile(servers, { treeShakable: false });

      expect(code).toContain("export class TestClient");
      expect(code).not.toContain("export function getTestClient");
      expect(code).not.toContain("let _test:");
    });
  });
});

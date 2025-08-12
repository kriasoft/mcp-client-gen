/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { findMcpConfigFiles, getMcpServers, MCP_CONFIG_PATHS } from "./config";

const TEST_DIR = resolve(import.meta.dir, "../test-fixtures");

beforeAll(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  mkdirSync(resolve(TEST_DIR, ".cursor"), { recursive: true });
  mkdirSync(resolve(TEST_DIR, ".vscode"), { recursive: true });
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("config", () => {
  describe("findMcpConfigFiles", () => {
    test("finds existing config files in priority order", async () => {
      // Create test config files
      writeFileSync(resolve(TEST_DIR, ".mcp.json"), "{}");
      writeFileSync(resolve(TEST_DIR, ".mcp.local.json"), "{}");
      writeFileSync(resolve(TEST_DIR, ".cursor/mcp.json"), "{}");

      const files = await findMcpConfigFiles(TEST_DIR);

      expect(files).toHaveLength(3);
      expect(files[0]).toEndWith(".mcp.local.json");
      expect(files[1]).toEndWith(".mcp.json");
      expect(files[2]).toEndWith(".cursor/mcp.json");
    });

    test("returns empty array when no config files exist", async () => {
      const files = await findMcpConfigFiles(resolve(TEST_DIR, "nonexistent"));
      expect(files).toEqual([]);
    });

    test("respects priority order from MCP_CONFIG_PATHS", () => {
      expect(MCP_CONFIG_PATHS[0]).toBe(".mcp.local.json");
      expect(MCP_CONFIG_PATHS[1]).toBe(".mcp.json");
    });
  });

  describe("getMcpServers", () => {
    test("parses valid MCP configuration", () => {
      const configPath = resolve(TEST_DIR, "valid-config.json");
      const config = {
        mcpServers: {
          notion: {
            type: "http",
            url: "https://mcp.notion.com/mcp",
          },
          github: {
            type: "sse",
            url: "https://api.githubcopilot.com/mcp/",
          },
        },
      };
      writeFileSync(configPath, JSON.stringify(config, null, 2));

      const servers = getMcpServers([configPath]);

      expect(servers).toHaveLength(2);
      expect(servers).toContainEqual({
        type: "http",
        url: "https://mcp.notion.com/mcp",
      });
      expect(servers).toContainEqual({
        type: "sse",
        url: "https://api.githubcopilot.com/mcp/",
      });
    });

    test("skips invalid server configurations", () => {
      const configPath = resolve(TEST_DIR, "invalid-servers.json");
      const config = {
        mcpServers: {
          valid: {
            type: "http",
            url: "https://example.com",
          },
          missingType: {
            url: "https://example.com",
          },
          missingUrl: {
            type: "http",
          },
          wrongType: "not-an-object",
        },
      };
      writeFileSync(configPath, JSON.stringify(config, null, 2));

      const servers = getMcpServers([configPath]);

      expect(servers).toHaveLength(1);
      expect(servers[0]).toEqual({
        type: "http",
        url: "https://example.com",
      });
    });

    test("handles malformed JSON gracefully", () => {
      const configPath = resolve(TEST_DIR, "malformed.json");
      writeFileSync(configPath, "{ invalid json");

      const servers = getMcpServers([configPath]);

      expect(servers).toEqual([]);
    });

    test("handles missing mcpServers property", () => {
      const configPath = resolve(TEST_DIR, "no-mcp-servers.json");
      writeFileSync(configPath, JSON.stringify({ otherConfig: true }));

      const servers = getMcpServers([configPath]);

      expect(servers).toEqual([]);
    });

    test("processes multiple config files", () => {
      const config1Path = resolve(TEST_DIR, "config1.json");
      const config2Path = resolve(TEST_DIR, "config2.json");

      writeFileSync(
        config1Path,
        JSON.stringify({
          mcpServers: {
            server1: { type: "http", url: "https://server1.com" },
          },
        }),
      );

      writeFileSync(
        config2Path,
        JSON.stringify({
          mcpServers: {
            server2: { type: "sse", url: "https://server2.com" },
          },
        }),
      );

      const servers = getMcpServers([config1Path, config2Path]);

      expect(servers).toHaveLength(2);
      expect(servers).toContainEqual({
        type: "http",
        url: "https://server1.com",
      });
      expect(servers).toContainEqual({
        type: "sse",
        url: "https://server2.com",
      });
    });

    test("deduplicates servers by URL (first wins)", () => {
      const config1Path = resolve(TEST_DIR, "duplicate1.json");
      const config2Path = resolve(TEST_DIR, "duplicate2.json");

      writeFileSync(
        config1Path,
        JSON.stringify({
          mcpServers: {
            server1: { type: "http", url: "https://example.com" },
            server2: { type: "sse", url: "https://other.com" },
          },
        }),
      );

      writeFileSync(
        config2Path,
        JSON.stringify({
          mcpServers: {
            server3: { type: "sse", url: "https://example.com" }, // Duplicate URL
            server4: { type: "http", url: "https://new.com" },
          },
        }),
      );

      const servers = getMcpServers([config1Path, config2Path]);

      expect(servers).toHaveLength(3);
      expect(servers).toContainEqual({
        type: "http", // First occurrence wins
        url: "https://example.com",
      });
      expect(servers).toContainEqual({
        type: "sse",
        url: "https://other.com",
      });
      expect(servers).toContainEqual({
        type: "http",
        url: "https://new.com",
      });
    });

    test("handles URLs with whitespace", () => {
      const configPath = resolve(TEST_DIR, "whitespace-urls.json");
      const config = {
        mcpServers: {
          trimmed: {
            type: "http",
            url: "  https://example.com  ",
          },
          empty: {
            type: "sse",
            url: "   ",
          },
          normal: {
            type: "http",
            url: "https://normal.com",
          },
        },
      };
      writeFileSync(configPath, JSON.stringify(config, null, 2));

      const servers = getMcpServers([configPath]);

      expect(servers).toHaveLength(2);
      expect(servers).toContainEqual({
        type: "http",
        url: "https://example.com", // Whitespace trimmed
      });
      expect(servers).toContainEqual({
        type: "http",
        url: "https://normal.com",
      });
    });

    test("handles invalid server types", () => {
      const configPath = resolve(TEST_DIR, "invalid-types.json");
      const config = {
        mcpServers: {
          validHttp: {
            type: "http",
            url: "https://example.com",
          },
          validSse: {
            type: "sse",
            url: "https://sse.com",
          },
          invalidType: {
            type: "websocket", // Not supported
            url: "https://invalid.com",
          },
          noType: {
            url: "https://notype.com",
          },
        },
      };
      writeFileSync(configPath, JSON.stringify(config, null, 2));

      const servers = getMcpServers([configPath]);

      expect(servers).toHaveLength(3);
      expect(servers).toContainEqual({
        type: "http",
        url: "https://example.com",
      });
      expect(servers).toContainEqual({
        type: "sse",
        url: "https://sse.com",
      });
      expect(servers).toContainEqual({
        type: "http", // noType defaults to HTTP for mcpServers format
        url: "https://notype.com",
      });
    });

    test("supports VSCode format with 'servers' property", () => {
      const configPath = resolve(TEST_DIR, "vscode-format.json");
      const config = {
        servers: {
          Github: {
            url: "https://api.githubcopilot.com/mcp/",
          },
          Perplexity: {
            type: "stdio",
            command: "npx",
            args: ["-y", "server-perplexity-ask"],
          },
          Custom: {
            type: "sse",
            url: "https://custom.example.com/mcp",
          },
        },
      };
      writeFileSync(configPath, JSON.stringify(config, null, 2));

      const servers = getMcpServers([configPath]);

      expect(servers).toHaveLength(2);
      expect(servers).toContainEqual({
        type: "http", // Default for VSCode HTTP servers
        url: "https://api.githubcopilot.com/mcp/",
      });
      expect(servers).toContainEqual({
        type: "sse",
        url: "https://custom.example.com/mcp",
      });
    });

    test("supports Cursor format without explicit type", () => {
      const configPath = resolve(TEST_DIR, "cursor-format.json");
      const config = {
        mcpServers: {
          "server-name": {
            url: "http://localhost:3000/mcp",
            headers: {
              API_KEY: "value",
            },
          },
          "explicit-http": {
            type: "http",
            url: "https://explicit.example.com",
          },
        },
      };
      writeFileSync(configPath, JSON.stringify(config, null, 2));

      const servers = getMcpServers([configPath]);

      expect(servers).toHaveLength(2);
      expect(servers).toContainEqual({
        type: "http", // Default for Cursor format
        url: "http://localhost:3000/mcp",
      });
      expect(servers).toContainEqual({
        type: "http",
        url: "https://explicit.example.com",
      });
    });

    test("supports Claude format with environment variables and headers", () => {
      const configPath = resolve(TEST_DIR, "claude-format.json");
      const config = {
        mcpServers: {
          "api-server": {
            type: "sse",
            url: "${API_BASE_URL:-https://api.example.com}/mcp",
            headers: {
              Authorization: "Bearer ${API_KEY}",
            },
          },
        },
      };
      writeFileSync(configPath, JSON.stringify(config, null, 2));

      const servers = getMcpServers([configPath]);

      expect(servers).toHaveLength(1);
      expect(servers[0]).toEqual({
        type: "sse",
        url: "${API_BASE_URL:-https://api.example.com}/mcp", // Environment variables preserved
      });
    });

    test("skips stdio servers from VSCode format", () => {
      const configPath = resolve(TEST_DIR, "vscode-stdio.json");
      const config = {
        servers: {
          StdioServer: {
            type: "stdio",
            command: "node",
            args: ["server.js"],
          },
          HttpServer: {
            url: "https://http.example.com",
          },
        },
      };
      writeFileSync(configPath, JSON.stringify(config, null, 2));

      const servers = getMcpServers([configPath]);

      expect(servers).toHaveLength(1);
      expect(servers[0]).toEqual({
        type: "http",
        url: "https://http.example.com",
      });
    });

    test("processes mixed format files", () => {
      const vscodePath = resolve(TEST_DIR, "mixed-vscode.json");
      const claudePath = resolve(TEST_DIR, "mixed-claude.json");

      writeFileSync(
        vscodePath,
        JSON.stringify({
          servers: {
            VSCodeServer: { url: "https://vscode.example.com" },
          },
        }),
      );

      writeFileSync(
        claudePath,
        JSON.stringify({
          mcpServers: {
            ClaudeServer: { type: "sse", url: "https://claude.example.com" },
          },
        }),
      );

      const servers = getMcpServers([vscodePath, claudePath]);

      expect(servers).toHaveLength(2);
      expect(servers).toContainEqual({
        type: "http",
        url: "https://vscode.example.com",
      });
      expect(servers).toContainEqual({
        type: "sse",
        url: "https://claude.example.com",
      });
    });
  });
});

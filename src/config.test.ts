/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  findMcpConfigFiles,
  formatConfigWarning,
  getMcpServers,
  MCP_CONFIG_PATHS,
  parseJsonc,
  resolveConfigFiles,
} from "./config";

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
  describe("formatConfigWarning", () => {
    test("formats malformed JSON warning", () => {
      const msg = formatConfigWarning({
        kind: "malformed_json",
        path: "/path/to/.mcp.json",
        error: "Unexpected token",
      });
      expect(msg).toBe(".mcp.json: Invalid JSON - Unexpected token");
    });

    test("formats skipped stdio warning", () => {
      const msg = formatConfigWarning({
        kind: "skipped_stdio",
        path: "/path/to/.mcp.json",
        name: "local-server",
      });
      expect(msg).toBe(
        '.mcp.json: Skipped "local-server" (stdio servers not supported)',
      );
    });

    test("formats missing URL warning", () => {
      const msg = formatConfigWarning({
        kind: "missing_url",
        path: "/path/to/.mcp.json",
        name: "broken-server",
      });
      expect(msg).toBe('.mcp.json: Skipped "broken-server" (missing url)');
    });

    test("formats unknown type warning", () => {
      const msg = formatConfigWarning({
        kind: "unknown_type",
        path: "/path/to/.mcp.json",
        name: "custom-server",
        type: "grpc",
      });
      expect(msg).toBe(
        '.mcp.json: Skipped "custom-server" (unknown type "grpc")',
      );
    });

    test("formats unresolved env warning", () => {
      const msg = formatConfigWarning({
        kind: "unresolved_env",
        path: "/path/to/.mcp.json",
        name: "api",
        variables: ["API_KEY", "API_HOST"],
      });
      expect(msg).toBe(
        '.mcp.json: Skipped "api" (unset environment variable API_KEY, API_HOST)',
      );
    });
  });

  describe("findMcpConfigFiles", () => {
    test("finds existing config files in priority order", async () => {
      // Simulate workspace with multiple config locations
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
      // .local variants should override non-local
      expect(MCP_CONFIG_PATHS[0]).toBe(".mcp.local.json");
      expect(MCP_CONFIG_PATHS[1]).toBe(".mcp.json");
    });
  });

  describe("resolveConfigFiles", () => {
    test("uses explicit configPath when provided", async () => {
      const configPath = resolve(TEST_DIR, "explicit.json");
      writeFileSync(configPath, JSON.stringify({ mcpServers: {} }));

      const files = await resolveConfigFiles({
        cwd: TEST_DIR,
        configPath: "explicit.json",
      });

      expect(files).toEqual([configPath]);
    });

    test("throws when explicit configPath does not exist", async () => {
      await expect(
        resolveConfigFiles({
          cwd: TEST_DIR,
          configPath: "nonexistent.json",
        }),
      ).rejects.toThrow("Configuration file not found: nonexistent.json");
    });

    test("uses discovery when no configPath provided", async () => {
      writeFileSync(resolve(TEST_DIR, ".mcp.json"), "{}");

      const files = await resolveConfigFiles({ cwd: TEST_DIR });

      expect(files.length).toBeGreaterThan(0);
      expect(files.some((f) => f.endsWith(".mcp.json"))).toBe(true);
    });

    test("throws when discovery finds nothing", async () => {
      const emptyDir = resolve(TEST_DIR, "empty-dir");
      mkdirSync(emptyDir, { recursive: true });

      await expect(resolveConfigFiles({ cwd: emptyDir })).rejects.toThrow(
        "No MCP configuration files found",
      );
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

      const { servers, warnings } = getMcpServers([configPath]);

      expect(servers).toHaveLength(2);
      expect(warnings).toHaveLength(0);
      expect(servers).toContainEqual({
        type: "http",
        url: "https://mcp.notion.com/mcp",
        name: "notion",
      });
      expect(servers).toContainEqual({
        type: "sse",
        url: "https://api.githubcopilot.com/mcp/",
        name: "github",
      });
    });

    test("skips invalid server configurations with warnings", () => {
      // Only http/sse with URLs are valid
      const configPath = resolve(TEST_DIR, "invalid-servers.json");
      const config = {
        mcpServers: {
          valid: {
            type: "http",
            url: "https://example.com",
          },
          missingUrl: {
            type: "http",
          },
          wrongType: "not-an-object",
        },
      };
      writeFileSync(configPath, JSON.stringify(config, null, 2));

      const { servers, warnings } = getMcpServers([configPath]);

      expect(servers).toHaveLength(1);
      expect(servers[0]).toEqual({
        type: "http",
        url: "https://example.com",
        name: "valid",
      });
      expect(warnings).toContainEqual({
        kind: "missing_url",
        path: configPath,
        name: "missingUrl",
      });
    });

    test("handles malformed JSON with warning", () => {
      const configPath = resolve(TEST_DIR, "malformed.json");
      writeFileSync(configPath, "{ invalid json");

      const { servers, warnings } = getMcpServers([configPath]);

      expect(servers).toEqual([]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.kind).toBe("malformed_json");
      expect(warnings[0]?.path).toBe(configPath);
    });

    test("handles missing mcpServers property", () => {
      const configPath = resolve(TEST_DIR, "no-mcp-servers.json");
      writeFileSync(configPath, JSON.stringify({ otherConfig: true }));

      const { servers, warnings } = getMcpServers([configPath]);

      expect(servers).toEqual([]);
      expect(warnings).toEqual([]);
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

      const { servers } = getMcpServers([config1Path, config2Path]);

      expect(servers).toHaveLength(2);
      expect(servers).toContainEqual({
        type: "http",
        url: "https://server1.com",
        name: "server1",
      });
      expect(servers).toContainEqual({
        type: "sse",
        url: "https://server2.com",
        name: "server2",
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

      const { servers } = getMcpServers([config1Path, config2Path]);

      expect(servers).toHaveLength(3);
      expect(servers).toContainEqual({
        type: "http", // First occurrence wins
        url: "https://example.com",
        name: "server1",
      });
      expect(servers).toContainEqual({
        type: "sse",
        url: "https://other.com",
        name: "server2",
      });
      expect(servers).toContainEqual({
        type: "http",
        url: "https://new.com",
        name: "server4",
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

      const { servers, warnings } = getMcpServers([configPath]);

      expect(servers).toHaveLength(2);
      expect(servers).toContainEqual({
        type: "http",
        url: "https://example.com", // Whitespace trimmed
        name: "trimmed",
      });
      expect(servers).toContainEqual({
        type: "http",
        url: "https://normal.com",
        name: "normal",
      });
      // Empty URL should generate a warning
      expect(warnings).toContainEqual({
        kind: "missing_url",
        path: configPath,
        name: "empty",
      });
    });

    test("handles invalid server types with warning", () => {
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

      const { servers, warnings } = getMcpServers([configPath]);

      expect(servers).toHaveLength(3);
      expect(servers).toContainEqual({
        type: "http",
        url: "https://example.com",
        name: "validHttp",
      });
      expect(servers).toContainEqual({
        type: "sse",
        url: "https://sse.com",
        name: "validSse",
      });
      expect(servers).toContainEqual({
        type: "http", // noType defaults to HTTP for mcpServers format
        url: "https://notype.com",
        name: "noType",
      });
      expect(warnings).toContainEqual({
        kind: "unknown_type",
        path: configPath,
        name: "invalidType",
        type: "websocket",
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

      const { servers, warnings } = getMcpServers([configPath]);

      expect(servers).toHaveLength(2);
      expect(servers).toContainEqual({
        type: "http", // Default for VSCode HTTP servers
        url: "https://api.githubcopilot.com/mcp/",
        name: "Github",
      });
      expect(servers).toContainEqual({
        type: "sse",
        url: "https://custom.example.com/mcp",
        name: "Custom",
      });
      // stdio server should generate a warning
      expect(warnings).toContainEqual({
        kind: "skipped_stdio",
        path: configPath,
        name: "Perplexity",
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

      const { servers } = getMcpServers([configPath]);

      expect(servers).toHaveLength(2);
      expect(servers).toContainEqual({
        type: "http", // Default for Cursor format
        url: "http://localhost:3000/mcp",
        name: "server-name",
        headers: { API_KEY: "value" },
      });
      expect(servers).toContainEqual({
        type: "http",
        url: "https://explicit.example.com",
        name: "explicit-http",
      });
    });

    describe("environment variable expansion", () => {
      const saved = { ...process.env };
      afterEach(() => {
        process.env = { ...saved };
      });

      function parse(server: object) {
        const configPath = resolve(TEST_DIR, "env.json");
        writeFileSync(
          configPath,
          JSON.stringify({ mcpServers: { api: server } }),
        );
        return getMcpServers([configPath]);
      }

      test("expands Claude-style ${NAME} and ${NAME:-default}", () => {
        process.env.MCP_TEST_KEY = "secret";
        delete process.env.MCP_TEST_BASE;
        const { servers, warnings } = parse({
          type: "sse",
          url: "${MCP_TEST_BASE:-https://api.example.com}/mcp",
          headers: { Authorization: "Bearer ${MCP_TEST_KEY}" },
        });
        expect(warnings).toEqual([]);
        expect(servers[0]).toEqual({
          type: "sse",
          url: "https://api.example.com/mcp",
          name: "api",
          headers: { Authorization: "Bearer secret" },
        });
      });

      test("expands VS Code-style ${env:NAME} in url and headers", () => {
        process.env.MCP_TEST_HOST = "mcp.example.com";
        process.env.MCP_TEST_KEY = "secret";
        const { servers } = parse({
          url: "https://${env:MCP_TEST_HOST}/mcp",
          headers: { "X-Api-Key": "${env:MCP_TEST_KEY}" },
        });
        expect(servers[0]?.url).toBe("https://mcp.example.com/mcp");
        expect(servers[0]?.headers).toEqual({ "X-Api-Key": "secret" });
      });

      test("uses the default when the variable is empty", () => {
        process.env.MCP_TEST_BASE = "";
        const { servers } = parse({ url: "${MCP_TEST_BASE:-https://a.dev}" });
        expect(servers[0]?.url).toBe("https://a.dev");
      });

      test("never reports fallback values; rejects nested placeholders", () => {
        process.env.MCP_TEST_KEY = "primary";
        const { servers, warnings } = parse({
          url: "https://a.dev/mcp",
          headers: {
            Authorization: "${API-KEY:-super-secret}",
            "X-Nested": "${MCP_TEST_KEY:-${MCP_TEST_OTHER}}",
          },
        });
        expect(servers).toEqual([]);
        expect(JSON.stringify(warnings)).not.toContain("super-secret");
        expect(warnings[0]).toMatchObject({
          kind: "unresolved_env",
          variables: ["API-KEY", "MCP_TEST_KEY"],
        });
      });

      test("skips a server with unset variables and names them", () => {
        delete process.env.MCP_TEST_MISSING;
        delete process.env.MCP_TEST_HOST;
        const { servers, warnings } = parse({
          url: "https://${env:MCP_TEST_HOST}/mcp",
          headers: {
            Authorization: "Bearer ${MCP_TEST_MISSING}",
            "X-Input": "${input:token}",
          },
        });
        expect(servers).toEqual([]);
        expect(warnings).toEqual([
          {
            kind: "unresolved_env",
            path: resolve(TEST_DIR, "env.json"),
            name: "api",
            variables: ["MCP_TEST_HOST", "MCP_TEST_MISSING", "input:token"],
          },
        ]);
      });
    });

    describe("JSONC", () => {
      test("parses VS Code mcp.json with comments and trailing commas", () => {
        const configPath = resolve(TEST_DIR, ".vscode/mcp.json");
        writeFileSync(
          configPath,
          `// VS Code MCP config
{
  /* servers
     block */
  "servers": {
    "a": { "url": "https://a.dev/mcp", }, // trailing comma
  },
  "inputs": [1, 2,],
}`,
        );
        const { servers, warnings } = getMcpServers([configPath]);
        expect(warnings).toEqual([]);
        expect(servers).toEqual([
          { type: "http", url: "https://a.dev/mcp", name: "a" },
        ]);
      });

      test("leaves string contents untouched", () => {
        expect(
          parseJsonc(
            String.raw`{"a": "https://x.dev//p", "b": "/* no */", "c": "x,}", "d": "q\"//,]", "e": "\\"}`,
          ),
        ).toEqual({
          a: "https://x.dev//p",
          b: "/* no */",
          c: "x,}",
          d: 'q"//,]',
          e: "\\",
        });
      });

      test("ends line comments at CR; strips a BOM", () => {
        expect(parseJsonc('\uFEFF// c\r{"a": 1}')).toEqual({ a: 1 });
      });

      test("still rejects invalid JSON and unterminated comments", () => {
        expect(() => parseJsonc("{,,}")).toThrow();
        expect(() => parseJsonc('{"a": 1} /* oops')).toThrow(
          "Unterminated /* comment",
        );
        expect(() => parseJsonc('{"a": 1 "b": 2}')).toThrow();
      });
    });

    test.each(["null", "[]", '"text"', "42"])(
      "warns on non-object root %s and continues",
      (root) => {
        const badPath = resolve(TEST_DIR, "bad-root.json");
        const goodPath = resolve(TEST_DIR, "good-root.json");
        writeFileSync(badPath, root);
        writeFileSync(
          goodPath,
          JSON.stringify({ mcpServers: { a: { url: "https://a.dev" } } }),
        );
        const { servers, warnings } = getMcpServers([badPath, goodPath]);
        expect(warnings).toEqual([
          {
            kind: "malformed_json",
            path: badPath,
            error: "Expected an object at the root",
          },
        ]);
        expect(servers).toHaveLength(1);
      },
    );

    test("skips stdio servers from VSCode format with warning", () => {
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

      const { servers, warnings } = getMcpServers([configPath]);

      expect(servers).toHaveLength(1);
      expect(servers[0]).toEqual({
        type: "http",
        url: "https://http.example.com",
        name: "HttpServer",
      });
      expect(warnings).toContainEqual({
        kind: "skipped_stdio",
        path: configPath,
        name: "StdioServer",
      });
    });

    test("supports VSCode nested mcp.servers format", () => {
      const configPath = resolve(TEST_DIR, "vscode-nested.json");
      const config = {
        mcp: {
          servers: {
            web: {
              type: "http",
              url: "https://api.web-mcp.com/mcp",
              headers: {
                "X-API-Key": "static-key",
              },
            },
          },
        },
      };
      writeFileSync(configPath, JSON.stringify(config, null, 2));

      const { servers } = getMcpServers([configPath]);

      expect(servers).toHaveLength(1);
      expect(servers[0]).toEqual({
        type: "http",
        url: "https://api.web-mcp.com/mcp",
        name: "web",
        headers: { "X-API-Key": "static-key" },
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

      const { servers } = getMcpServers([vscodePath, claudePath]);

      expect(servers).toHaveLength(2);
      expect(servers).toContainEqual({
        type: "http",
        url: "https://vscode.example.com",
        name: "VSCodeServer",
      });
      expect(servers).toContainEqual({
        type: "sse",
        url: "https://claude.example.com",
        name: "ClaudeServer",
      });
    });
  });
});

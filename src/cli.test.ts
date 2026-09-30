/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { join, resolve } from "node:path";

/**
 * Runs the real CLI in a subprocess: cli.ts calls main() on import and exits
 * the process, so observable behavior (streams, exit codes) is the contract.
 * Servers point at a closed port, so generation fails fast after mode selection.
 */

const CLI = resolve(import.meta.dir, "cli.ts");
let cwd: string;

function run(...args: string[]) {
  const proc = Bun.spawnSync(["bun", CLI, ...args], {
    cwd,
    stdin: "ignore",
    timeout: 10_000,
  });
  return {
    exitCode: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), "mcp-cli-"));
  writeFileSync(
    join(cwd, ".mcp.json"),
    JSON.stringify({
      mcpServers: {
        remote: { url: "http://127.0.0.1:1/mcp" },
        local: { command: "node", args: ["server.js"] },
      },
    }),
  );
});

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("cli", () => {
  describe("config mode output", () => {
    test("-y honors --output", () => {
      const { stdout } = run("-y", "-o", "chosen.ts");
      expect(stdout).toContain("→ chosen.ts");
      expect(stdout).not.toContain("mcp-client.ts");
    });

    test("--output without -y skips prompts, like a positional output", () => {
      expect(run("-o", "chosen.ts").stdout).toContain("→ chosen.ts");
      expect(run("chosen.ts").stdout).toContain("→ chosen.ts");
    });
  });

  test("prints config warnings to stderr even when servers remain", () => {
    const { stdout, stderr } = run("-y");
    expect(stderr).toContain('Skipped "local" (stdio servers not supported)');
    expect(stdout).not.toContain("Skipped");
  });

  describe("argument errors", () => {
    test("unknown flag prints error and help to stderr, exits 1", () => {
      const { exitCode, stdout, stderr } = run("https://a.example/mcp", "--x");
      expect(exitCode).toBe(1);
      expect(stdout).toBe("");
      expect(stderr).toContain("Error parsing arguments");
      expect(stderr).toContain("Usage:");
    });

    test("missing option value exits 1 with empty stdout", () => {
      const { exitCode, stdout } = run("https://a.example/mcp", "-o");
      expect(exitCode).toBe(1);
      expect(stdout).toBe("");
    });

    test("--help prints to stdout and exits 0", () => {
      const { exitCode, stdout, stderr } = run("--help");
      expect(exitCode).toBe(0);
      expect(stdout).toContain("Usage:");
      expect(stderr).toBe("");
    });
  });

  describe("after generating", () => {
    test("never echoes config URLs, which may hold expanded secrets", async () => {
      const mcp = createMcpHandler(() => {
        const server = new McpServer({ name: "demo", version: "1.0.0" });
        server.registerTool("ping", {}, async () => ({ content: [] }));
        return server;
      });
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        // Like many servers, a 404 echoes the requested URL
        fetch: (request) =>
          new URL(request.url).pathname.startsWith("/fail")
            ? new Response(`Not found: ${request.url}`, { status: 404 })
            : mcp.fetch(request),
      });
      const dir = mkdtempSync(join(tmpdir(), "mcp-cli-"));
      writeFileSync(
        join(dir, ".mcp.json"),
        JSON.stringify({
          mcpServers: {
            // The secret sits in the path as well as the query
            demo: { url: `${server.url}\${TOKEN}?key=\${TOKEN}` },
            // Fails to connect: its error message must not carry the secret either
            broken: { url: `${server.url}fail/\${TOKEN}?key=\${TOKEN}` },
          },
        }),
      );
      try {
        // Async spawn: a sync one would block this process's server
        const proc = Bun.spawn(["bun", CLI, "-y", "-o", "out.ts"], {
          cwd: dir,
          env: { ...process.env, TOKEN: "SECRET_123" },
          stdout: "pipe",
          stderr: "pipe",
        });
        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        await proc.exited;
        expect(stdout + stderr).not.toContain("SECRET_123");
        expect(stdout).toContain('"demo" in your MCP config');
      } finally {
        await server.stop(true);
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});

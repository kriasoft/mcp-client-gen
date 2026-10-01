/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
      const { stdout } = run("-y", "-o", "chosen");
      expect(stdout).toContain("→ chosen/");
      expect(stdout).not.toContain("mcp/");
    });

    test("--output without -y skips prompts, like a positional output", () => {
      expect(run("-o", "chosen").stdout).toContain("→ chosen/");
      expect(run("chosen").stdout).toContain("→ chosen/");
    });

    test("rejects a file: each server gets its own module", () => {
      const { exitCode, stderr } = run("-y", "-o", "client.ts");
      expect(exitCode).toBe(1);
      expect(stderr).toContain("pass a directory");
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

  describe("generating", () => {
    let server: ReturnType<typeof Bun.serve>;
    let dir: string;

    beforeAll(() => {
      const mcp = createMcpHandler(() => {
        const server = new McpServer({ name: "demo", version: "1.0.0" });
        server.registerTool("ping", {}, async () => ({ content: [] }));
        return server;
      });
      server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        // Like many servers, a 404 echoes the requested URL
        fetch: (request) =>
          new URL(request.url).pathname.startsWith("/404")
            ? new Response(`Not found: ${request.url}`, { status: 404 })
            : mcp.fetch(request),
      });
    });

    afterAll(() => server.stop(true));
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "mcp-cli-"));
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    /** Async spawn: a sync one would block this process's server. */
    async function generate(mcpServers: object, ...args: string[]) {
      writeFileSync(join(dir, ".mcp.json"), JSON.stringify({ mcpServers }));
      const proc = Bun.spawn(["bun", CLI, ...args], {
        cwd: dir,
        // Space and slash: URLs serialize these differently than the raw value
        env: { ...process.env, TOKEN: "SECRET 123/x" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      return { exitCode: await proc.exited, stdout, stderr };
    }

    // The secret sits in the path as well as the query
    const demo = () => ({ url: `${server.url}\${TOKEN}?key=\${TOKEN}` });
    const broken = () => ({ url: `${server.url}404/\${TOKEN}?key=\${TOKEN}` });

    test("writes one module per server and shows how to connect", async () => {
      const { exitCode, stdout } = await generate(
        { demo: demo() },
        "-y",
        "-o",
        "out",
      );

      expect(exitCode).toBe(0);
      expect(existsSync(join(dir, "out/demo.ts"))).toBe(true);
      expect(stdout).toContain(
        'await client.connect(new StreamableHTTPClientTransport(new URL("..."))); // "demo" in your MCP config',
      );
      expect(stdout).toContain(
        'import { createDemoClient } from "./out/demo.js";',
      );
      // Config URLs may hold expanded secrets: never echoed
      expect(stdout).not.toContain("SECRET");
    });

    test("leaves existing modules untouched when a write fails", async () => {
      mkdirSync(join(dir, "out/beta.ts"), { recursive: true });
      writeFileSync(join(dir, "out/alpha.ts"), "old");

      const { exitCode, stderr } = await generate(
        // Distinct URLs: config entries sharing one are deduplicated
        { alpha: demo(), beta: { url: `${demo().url}&b` } },
        "-y",
        "-o",
        "out",
      );

      expect(exitCode).toBe(1);
      expect(stderr).toContain("it is a directory");
      expect(readFileSync(join(dir, "out/alpha.ts"), "utf8")).toBe("old");
      expect(readdirSync(join(dir, "out")).sort()).toEqual([
        "alpha.ts",
        "beta.ts",
      ]);
    });

    test("writes nothing when any server fails, and redacts its error", async () => {
      const { exitCode, stdout, stderr } = await generate(
        { demo: demo(), broken: broken() },
        "-y",
        "-o",
        "out",
      );

      expect(exitCode).toBe(1);
      expect(stderr).toContain(
        '1 of 2 servers failed; no files written:\n  - "broken"',
      );
      expect(existsSync(join(dir, "out"))).toBe(false);
      expect(stdout + stderr).not.toContain("SECRET");
    });

    test("URL mode writes the file and echoes the given URL", async () => {
      const url = `${server.url}mcp`;
      const { exitCode, stdout } = await generate(
        {},
        url,
        "-o",
        "demo.ts",
        "--name",
        "demo",
      );

      expect(exitCode).toBe(0);
      expect(existsSync(join(dir, "demo.ts"))).toBe(true);
      expect(stdout).toContain(`new URL(${JSON.stringify(url)})`);
    });
  });
});

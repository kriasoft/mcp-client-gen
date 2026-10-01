/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * Release gate for what npm users get, which Bun source tests can't see (bundling, JSON
 * imports, declarations, package contents): pack `dist/`, install the tarball into a
 * clean consumer, then under Node run the CLI and the library against a real MCP server,
 * and compile and run the generated modules the way a fresh TypeScript project would
 * (`skipLibCheck: false`, `types: ["node"]`). Needs `bun run build` first, and network.
 * Extra tarballs (e.g. an unreleased oauth-callback) install alongside, replacing registry
 * versions.
 *
 *   bun run build && bun run smoke:package [path/to/dependency.tgz ...]
 */

import {
  createMcpHandler,
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/server";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const root = resolve(import.meta.dir, "..");
const extraTarballs = process.argv.slice(2).map((path) => resolve(path));
const dir = mkdtempSync(join(tmpdir(), "mcp-client-gen-smoke-"));
// Async: the server below runs in this process, so a blocking call would starve it
const run = async (cmd: string, args: string[], cwd = dir) =>
  (await promisify(execFile)(cmd, args, { cwd, encoding: "utf8" })).stdout;

const mcp = createMcpHandler(() => {
  const server = new McpServer({ name: "smoke", version: "1.0.0" });
  server.registerTool("add", {}, async () => ({
    content: [{ type: "text", text: "5" }],
  }));
  server.registerResource(
    "issue",
    new ResourceTemplate("repo://{owner}/issues/{id}", { list: undefined }),
    {},
    async (uri) => ({ contents: [{ uri: uri.href, text: "issue" }] }),
  );
  return server;
});
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: mcp.fetch });
const url = new URL("/mcp", server.url).href;

try {
  console.log(
    `Node ${(await run("node", ["--version"])).trim()}, consumer in ${dir}`,
  );
  const tarball = (
    await run("npm", ["pack", "--silent", "--pack-destination", dir], root)
  ).trim();
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "consumer", private: true, type: "module" }),
  );
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        strict: true,
        noUnusedLocals: true,
        skipLibCheck: false,
        types: ["node"], // the SDK's declarations reference Buffer
        rootDir: "src",
        outDir: "out",
      },
      include: ["src"],
    }),
  );
  await run("npm", [
    "install",
    "--silent",
    "--no-audit",
    "--no-fund",
    join(dir, tarball),
    ...extraTarballs,
    // The oldest supported consumer: deterministic, and what the README promises
    "@modelcontextprotocol/client@2.2.0",
    "typescript@6",
    "@types/node@22",
  ]);

  // The installed bin and library, under Node
  const cli = join(dir, "node_modules/.bin/mcp-client-gen");
  if (!(await run(cli, ["--help"])).includes("Usage:"))
    throw new Error("--help");
  await run(cli, [url, "--no-oauth", "--name", "smoke", "-o", "src/smoke.ts"]);
  await run("node", [
    "--input-type=module",
    "-e",
    `import { writeFileSync } from "node:fs";
     import { generateClientModule } from "mcp-client-gen";
     writeFileSync("src/lib.ts", await generateClientModule(${JSON.stringify(url)}, { name: "lib", oauth: false }));`,
  ]);

  writeFileSync(
    join(dir, "src/main.ts"),
    `import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { GenerateClientOptions, McpEndpoint } from "mcp-client-gen";
import { createLibClient } from "./lib.js";
import { createSmokeClient } from "./smoke.js";

export const options: GenerateClientOptions = { name: "x", oauth: false };
export const endpoint: McpEndpoint = { url: "https://example.com/mcp", transport: "http" };

const client = new Client({ name: "smoke", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
await client.connect(new StreamableHTTPClientTransport(new URL(process.argv[2]!)));
await client.listTools();
const smoke = createSmokeClient(client);
const lib = createLibClient(client);
const added = await smoke.add();
const issue = await lib.resources.issue({ owner: "a b", id: "1" }, { cacheMode: "bypass" });
console.log(JSON.stringify([added.content[0], issue.contents[0]?.uri]));
await client.close();
`,
  );
  await run(join(dir, "node_modules/.bin/tsc"), ["-p", "."]);
  const output = (await run("node", ["out/main.js", url])).trim();
  const expected = JSON.stringify([
    { type: "text", text: "5" },
    "repo://a%20b/issues/1",
  ]);
  if (output !== expected)
    throw new Error(`Expected ${expected}, got ${output}`);
  console.log("Package smoke test passed");
} catch (error) {
  const { stdout, stderr } = error as { stdout?: string; stderr?: string };
  console.error(stdout ?? "", stderr ?? "");
  throw error;
} finally {
  await server.stop(true);
  rmSync(dir, { recursive: true, force: true });
}

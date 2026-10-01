#!/usr/bin/env node
/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * CLI entry - parses args, determines mode, generates, writes.
 *
 * Modes: url (one server → file or stdout), interactive / quick (config servers → one
 * module per server in a directory). Owns: UX, defaults, exit codes, file writes.
 */

import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import {
  camelCase,
  clientTypeName,
  generateClientFile,
} from "./codegen/index.js";
import { redactSecrets } from "./config.js";
import { introspectServer, type Introspection } from "./introspection.js";
import { extractServerName, formatTypeScript } from "./pipeline.js";
import { runInteractiveSetup, withSpinner } from "./prompts.js";
import type { McpServerConfig } from "./types.js";

/**
 * CLI execution modes. The grammar is small on purpose, and anything outside it is an
 * error rather than silently ignored:
 *
 *   mcp-client-gen <url> [-o file] [--name name]      URL mode (stdout without -o)
 *   mcp-client-gen [--config file] [-y] [-o dir]      config mode
 *
 * Config mode prompts unless `-y` or `-o` is given.
 */
type CliMode =
  | { kind: "help" }
  | { kind: "url"; url: string; output?: string; name?: string }
  | { kind: "interactive"; configPath?: string }
  | { kind: "quick"; output?: string; configPath?: string };

function showHelp(write: (text: string) => void = console.log) {
  write(`
mcp-client-gen - Generate type-safe MCP client SDK

Usage:
  npx mcp-client-gen <url> [-o file] [--name name]   # From an MCP server URL
  npx mcp-client-gen [--config file] [-y] [-o dir]   # From local MCP configs

URL mode:
  <url>                 MCP server URL (http:// or https://)
  -o, --output <file>   Output file (default: stdout)
  --name <name>         Client name: notion → createNotionClient (default: from the URL)

Config mode (.mcp.json, .cursor/, .vscode/; one module per server):
  --config <file>       Config file to read instead of discovering them
  -y, --yes             All servers, default directory, no prompts
  -o, --output <dir>    Output directory (implies -y; default: src/mcp or mcp)

  -h, --help            Show this help message

Examples:
  npx mcp-client-gen https://mcp.notion.com/mcp
  npx mcp-client-gen https://mcp.notion.com/mcp -o src/notion.ts
  npx mcp-client-gen                        # Interactive
  npx mcp-client-gen -y -o src/mcp          # All configured servers
`);
}

function isHttpUrl(value: string): boolean {
  return URL.canParse(value) && /^https?:$/.test(new URL(value).protocol);
}

/**
 * Parse CLI arguments into a mode.
 * @throws For anything outside the grammar (see CliMode); main() prints help to stderr
 */
function parseArguments(args: string[]): CliMode {
  const { values, positionals } = parseArgs({
    args,
    options: {
      name: { type: "string" },
      output: { type: "string", short: "o" },
      config: { type: "string" },
      help: { type: "boolean", short: "h" },
      yes: { type: "boolean", short: "y" },
    },
    allowPositionals: true,
  });

  if (values.help) return { kind: "help" };
  for (const option of ["name", "output", "config"] as const)
    if (values[option] === "") throw new Error(`--${option} needs a value`);
  if (positionals.length > 1)
    throw new Error(`Unexpected argument: ${positionals[1]}`);

  const [url] = positionals;
  if (url !== undefined) {
    if (!isHttpUrl(url))
      throw new Error(`Expected an http(s) MCP server URL, got: ${url}`);
    if (values.config !== undefined || values.yes)
      throw new Error("--config and -y apply to config mode, not a URL");
    return { kind: "url", url, output: values.output, name: values.name };
  }

  if (values.name !== undefined)
    throw new Error(
      "--name applies to URL mode; config entries are named by their keys",
    );
  if (values.output || values.yes)
    return { kind: "quick", output: values.output, configPath: values.config };
  return { kind: "interactive", configPath: values.config };
}

/** A server to generate, with its derived name and destination. */
interface Target {
  server: McpServerConfig;
  name: string;
  /** Output path as given (relative to cwd); undefined for stdout */
  file?: string;
}

/** Module file name for a server: kebab-case of its client name (`GitHub` → `git-hub`). */
function moduleFileName(name: string): string {
  const base = clientTypeName(name).slice(0, -"Client".length);
  return base.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase() + ".ts";
}

/** Introspect and generate one target; formatted with the destination's Prettier config. */
async function generate(
  target: Target,
): Promise<{ code: string; introspection: Introspection }> {
  const introspection = await introspectServer(target.server);
  const code = await formatTypeScript(
    generateClientFile(target.name, introspection),
    resolve(target.file ?? "client.ts"),
  );
  return { code, introspection };
}

/**
 * Write every module or none: stage each as a temp file beside its destination, then
 * rename into place. A failed write (e.g. a read-only directory) leaves no file changed;
 * only a failing rename (e.g. an immutable destination) can leave earlier ones replaced.
 */
async function writeModules(files: Array<{ file: string; code: string }>) {
  const staged: Array<{ temp: string; dest: string }> = [];
  try {
    for (const { file, code } of files) {
      const dest = resolve(file);
      // Replacing a directory would fail only at rename: catch it before touching anything
      if ((await stat(dest).catch(() => undefined))?.isDirectory())
        throw new Error(`Can't write ${file}: it is a directory`);
      await mkdir(dirname(dest), { recursive: true });
      const temp = `${dest}.${process.pid}.tmp`;
      staged.push({ temp, dest });
      await writeFile(temp, code, "utf-8");
    }
    for (const { temp, dest } of staged) await rename(temp, dest);
  } catch (error) {
    // Renamed temps are gone already; force ignores them
    await Promise.all(staged.map(({ temp }) => rm(temp, { force: true })));
    throw error;
  }
}

/**
 * Print how to connect and use a generated client: the SDK client, plus oauth-callback
 * when the server used OAuth during generation.
 */
function printUsage(target: Target, authorized: boolean, fromConfig: boolean) {
  const { server, name, file } = target;
  const factory = `create${clientTypeName(name)}`;
  // `{name}Client`: never a reserved word, `client` or `auth`
  const variable = camelCase(name) + "Client";
  const rel = relative(process.cwd(), resolve(file!))
    .split(sep)
    .join("/")
    .replace(/\.ts$/, ".js");
  const importPath = JSON.stringify(rel.startsWith(".") ? rel : `./${rel}`);
  const sse = server.type === "sse";
  const transport = sse
    ? "SSEClientTransport"
    : "StreamableHTTPClientTransport";
  // Config URLs may embed expanded secrets anywhere (host, path, query): point to
  // the entry instead. A command-line URL is the user's own input.
  const url = fromConfig ? '"..."' : JSON.stringify(server.url);
  const urlNote = fromConfig
    ? ` // ${JSON.stringify(server.name)} in your MCP config${server.headers ? ", plus its headers" : ""}`
    : "";
  // browserAuth().connect() speaks Streamable HTTP; SSE takes the provider directly
  const oauth = authorized && !sse;

  const lines = [
    `import { Client${oauth ? "" : `, ${transport}`} } from "@modelcontextprotocol/client";`,
    ...(oauth ? [`import { browserAuth } from "oauth-callback/mcp";`] : []),
    `import { ${factory} } from ${importPath};`,
    ``,
    // Streamable HTTP negotiates the newest protocol era, as generation did
    sse
      ? `const client = new Client({ name: "my-app", version: "1.0.0" });`
      : `const client = new Client({ name: "my-app", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });`,
    ...(oauth
      ? [
          `const auth = browserAuth({`,
          `  serverUrl: ${url},${urlNote}`,
          `  redirectUri: "http://127.0.0.1:3000/callback",`,
          `  clientName: "my-app",`,
          `});`,
          `await auth.connect(client); // opens the browser when needed`,
        ]
      : [
          `await client.connect(new ${transport}(new URL(${url})));${urlNote}`,
          ...(authorized
            ? [
                `// This legacy SSE server uses OAuth: give the transport { authProvider: browserAuth(...) }`,
                `// from oauth-callback/mcp, and on UnauthorizedError call auth.completeAuthorization(transport),`,
                `// then reconnect on a new transport (see the oauth-callback docs).`,
              ]
            : []),
        ]),
    `const ${variable} = ${factory}(client);`,
  ];
  console.log(
    `\nUsage (npm install @modelcontextprotocol/client${authorized ? " oauth-callback" : ""}):\n`,
  );
  for (const line of lines) console.log(line ? `  ${line}` : "");
}

async function runUrlMode(mode: Extract<CliMode, { kind: "url" }>) {
  const server: McpServerConfig = {
    type: "http",
    url: mode.url,
    name: mode.name,
  };
  const target: Target = {
    server,
    name: extractServerName(server),
    file: mode.output,
  };
  if (!target.file) {
    // Stdout: just the code
    process.stdout.write((await generate(target)).code);
    return;
  }
  const { code, introspection } = await withSpinner(
    `Introspecting ${target.name}`,
    () => generate(target),
  );
  await writeModules([{ file: target.file!, code }]);
  console.log(`\nGenerated ${target.file}`);
  printUsage(target, introspection.authorized, false);
}

/**
 * Config mode: one module per server, all or nothing. A failing server (e.g. an auth
 * outage) must not silently drop its client from the project, so nothing is written
 * unless every server succeeds. Servers are introspected one at a time: each may run a
 * browser flow on the same loopback port.
 */
async function runConfigMode(servers: McpServerConfig[], outputDir: string) {
  if (outputDir.endsWith(".ts"))
    throw new Error(
      `Config mode writes one module per server; pass a directory, not "${outputDir}"`,
    );
  const targets: Target[] = servers.map((server) => {
    const name = extractServerName(server);
    return { server, name, file: join(outputDir, moduleFileName(name)) };
  });

  // Distinct names must not share a file; check before introspecting (it may run OAuth)
  const byFile = Map.groupBy(targets, (t) => t.file!);
  const clashes = [...byFile].filter(([, group]) => group.length > 1);
  if (clashes.length > 0)
    throw new Error(
      `Server names collide in generated files. Rename them in your MCP config:\n${clashes
        .map(
          ([file, group]) =>
            `  - ${group.map((t) => `"${t.name}"`).join(", ")} → ${file}`,
        )
        .join("\n")}`,
    );

  const results: Array<{ code: string; introspection: Introspection }> = [];
  const failures: string[] = [];
  for (const target of targets) {
    try {
      results.push(
        await withSpinner(`Introspecting "${target.name}"`, () =>
          generate(target),
        ),
      );
    } catch (error) {
      failures.push(
        `  - "${target.name}": ${redactSecrets((error as Error).message)}`,
      );
    }
  }
  if (failures.length > 0)
    throw new Error(
      `${failures.length} of ${targets.length} server${targets.length === 1 ? "" : "s"} failed; no files written:\n${failures.join("\n")}`,
    );

  await writeModules(
    targets.map((target, i) => ({
      file: target.file!,
      code: results[i]!.code,
    })),
  );
  console.log(`\nGenerated ${targets.map((t) => t.file).join(", ")}`);
  printUsage(targets[0]!, results[0]!.introspection.authorized, true);
}

async function main() {
  let mode: CliMode;
  try {
    mode = parseArguments(process.argv.slice(2));
  } catch (error) {
    // parseArgs throws TypeErrors for unknown options and missing values. stderr keeps
    // stdout code-only for piped URL-mode output.
    console.error(`Error: ${redactSecrets((error as Error).message)}`);
    showHelp(console.error);
    process.exit(1);
  }
  try {
    switch (mode.kind) {
      case "help":
        showHelp();
        return;
      case "url":
        await runUrlMode(mode);
        return;
      case "interactive":
      case "quick": {
        const setup = await runInteractiveSetup(process.cwd(), {
          useDefaults: mode.kind === "quick",
          configPath: mode.configPath,
          outputDir: mode.kind === "quick" ? mode.output : undefined,
        });
        await runConfigMode(setup.servers, setup.outputDir);
        return;
      }
    }
  } catch (error) {
    console.error("Error:", redactSecrets((error as Error).message));
    process.exit(1);
  }
}

main();

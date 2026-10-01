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
 * CLI execution modes - explicitly modeled for clarity and extensibility.
 *
 * Mode selection priority:
 * 1. --help → help
 * 2. --url flag → URL mode
 * 3. First positional is URL (http/https) → URL mode
 * 4. -y flag or output (-o or positional) → quick mode (config-based, all servers)
 * 5. Otherwise → interactive mode (config-based, prompts)
 *
 * An output means "no prompts" in config mode, so `-o dir` and a positional `dir`
 * behave the same, as they do in URL mode.
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
  npx mcp-client-gen <url> [file]           # Generate from MCP server URL
  npx mcp-client-gen                        # Interactive mode (uses local configs)
  npx mcp-client-gen -y [dir]               # Quick mode (uses local configs)

Arguments:
  <url>             MCP server URL (http:// or https://)
  [file]            URL mode: output file (default: stdout)
  [dir]             Config mode: output directory, one module per server
                    (default: src/mcp or mcp); implies -y

Options:
  --url <url>       Explicit URL source (escape hatch for edge cases)
  --name <name>     Override server name (URL mode only)
  -o, --output <path>  Output file (URL mode) or directory (config mode)
  --config <file>   Path to MCP configuration file
  -y, --yes         Accept defaults (all servers), skip prompts
  -h, --help        Show this help message

Examples:
  # URL mode (primary)
  npx mcp-client-gen https://mcp.notion.com/mcp
  npx mcp-client-gen https://mcp.notion.com/mcp -o notion.ts
  npx mcp-client-gen https://mcp.notion.com/mcp notion.ts
  npx mcp-client-gen --url https://mcp.notion.com/mcp --name notion

  # Config mode (uses .mcp.json, .cursor/, .vscode/)
  npx mcp-client-gen                        # Interactive
  npx mcp-client-gen -y                     # Quick defaults
  npx mcp-client-gen -y -o src/mcp          # Quick + output directory
  npx mcp-client-gen src/mcp                # Same as above
`);
}

/** Check if string looks like a URL */
function isUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

/**
 * Parse CLI arguments and determine execution mode.
 * See CliMode for priority order.
 */
function parseArguments(): CliMode {
  try {
    const { values, positionals } = parseArgs({
      options: {
        url: { type: "string" },
        name: { type: "string" },
        output: { type: "string", short: "o" },
        config: { type: "string" },
        help: { type: "boolean", short: "h" },
        yes: { type: "boolean", short: "y" },
      },
      allowPositionals: true,
    });

    if (values.help) {
      return { kind: "help" };
    }

    // Explicit --url flag takes priority
    if (values.url) {
      // Output: -o flag > first positional (if not URL)
      const output =
        values.output ??
        (positionals[0] && !isUrl(positionals[0]) ? positionals[0] : undefined);
      return { kind: "url", url: values.url, output, name: values.name };
    }

    // First positional is URL → URL mode
    if (positionals[0] && isUrl(positionals[0])) {
      // Output: -o flag > second positional
      const output = values.output ?? positionals[1];
      return { kind: "url", url: positionals[0], output, name: values.name };
    }

    // Config mode: output path or -y → quick, otherwise interactive
    const output = values.output ?? positionals[0];
    if (output || values.yes) {
      return { kind: "quick", output, configPath: values.config };
    }
    return { kind: "interactive", configPath: values.config };
  } catch (error) {
    // stderr keeps stdout code-only for piped URL-mode output
    console.error("Error parsing arguments:", (error as Error).message);
    showHelp(console.error);
    process.exit(1);
  }
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
    `const client = new Client({ name: "my-app", version: "1.0.0" });`,
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
  const mode = parseArguments();
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

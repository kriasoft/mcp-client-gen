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
import {
  printable,
  registerUrlCredentials,
  type ConfiguredServer,
} from "./config.js";
import {
  oauthRedirectUri,
  type ConnectOptions,
  type McpEndpoint,
} from "./connect.js";
import { introspectServer, type ServerSnapshot } from "./introspection.js";
import { extractServerName, formatTypeScript } from "./pipeline.js";
import { runInteractiveSetup, withSpinner } from "./prompts.js";

/**
 * CLI execution modes. The grammar is small on purpose, and anything outside it is an
 * error rather than silently ignored:
 *
 *   mcp-client-gen <url> [-o file] [--name name] [auth]     URL mode (stdout without -o)
 *   mcp-client-gen [--config file] [-y] [-o dir] [auth]     config mode
 *   auth: --no-oauth | --oauth-port <port>
 *
 * Config mode prompts unless `-y` or `-o` is given.
 */
type CliMode =
  | { kind: "help" }
  | ({ kind: "url"; url: string; output?: string; name?: string } & AuthMode)
  | ({ kind: "interactive"; configPath?: string } & AuthMode)
  | ({ kind: "quick"; output?: string; configPath?: string } & AuthMode);

/** `--no-oauth` never opens a browser; `--oauth-port` moves its loopback redirect. */
type AuthMode = { noOAuth: boolean; oauthPort?: number };

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

  --no-oauth            Never open a browser: a server demanding OAuth fails (e.g. in CI)
  --oauth-port <port>   OAuth redirect port on 127.0.0.1 (default: 3000)
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
      "no-oauth": { type: "boolean" },
      "oauth-port": { type: "string" },
    },
    allowPositionals: true,
  });

  if (values.help) return { kind: "help" };
  for (const option of ["name", "output", "config"] as const)
    if (values[option] === "") throw new Error(`--${option} needs a value`);
  if (positionals.length > 1)
    throw new Error(`Unexpected argument: ${positionals[1]}`);

  const auth: AuthMode = { noOAuth: values["no-oauth"] === true };
  const port = values["oauth-port"];
  if (port !== undefined) {
    if (!/^\d{1,5}$/.test(port) || +port < 1 || +port > 65535)
      throw new Error(
        `--oauth-port needs a port from 1 to 65535, got: ${port}`,
      );
    if (auth.noOAuth)
      throw new Error("--oauth-port has no effect with --no-oauth");
    auth.oauthPort = +port;
  }
  const [url] = positionals;
  if (url !== undefined) {
    if (!isHttpUrl(url))
      throw new Error(`Expected an http(s) MCP server URL, got: ${url}`);
    if (values.config !== undefined || values.yes)
      throw new Error("--config and -y apply to config mode, not a URL");
    return {
      kind: "url",
      url,
      output: values.output,
      name: values.name,
      ...auth,
    };
  }

  if (values.name !== undefined)
    throw new Error(
      "--name applies to URL mode; config entries are named by their keys",
    );
  if (values.output || values.yes)
    return {
      kind: "quick",
      output: values.output,
      configPath: values.config,
      ...auth,
    };
  return { kind: "interactive", configPath: values.config, ...auth };
}

/**
 * An error with a list of already printable items, one per line: `printable()` keeps
 * each value on one line, so the layout is the CLI's own.
 */
class ListedError extends Error {
  constructor(
    message: string,
    readonly items: string[],
  ) {
    super(message);
  }
}

/** Print an error (and its items) to stderr, made safe for the terminal. */
function printError(error: unknown) {
  console.error(`Error: ${printable(error)}`);
  if (error instanceof ListedError)
    for (const item of error.items) console.error(`  - ${item}`);
}

/** A server to generate, with its derived name and destination. */
interface Target {
  endpoint: McpEndpoint;
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
  options: ConnectOptions,
): Promise<{ code: string; snapshot: ServerSnapshot }> {
  const snapshot = await introspectServer(target.endpoint, options);
  const code = await formatTypeScript(
    generateClientFile(target.name, snapshot),
    resolve(target.file ?? "client.ts"),
  );
  return { code, snapshot };
}

/**
 * Stage every module as a temp file beside its destination, then
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

/** `import { createXClient } from "./x.js";` for a module written to `file`. */
function importLine(factory: string, file: string): string {
  const rel = relative(process.cwd(), resolve(file))
    .split(sep)
    .join("/")
    .replace(/\.ts$/, ".js");
  return `import { ${factory} } from ${JSON.stringify(rel.startsWith(".") ? rel : `./${rel}`)};`;
}

/**
 * Print the whole connection for a URL-mode client (always Streamable HTTP): the SDK
 * client, plus oauth-callback when the server used OAuth during generation.
 */
function printUrlUsage(
  { endpoint, name, file }: Target,
  { authorized, tools }: ServerSnapshot,
  oauthPort: number | undefined,
) {
  const factory = `create${clientTypeName(name)}`;
  // `{name}Client`: never a reserved word, `client` or `auth`
  const variable = camelCase(name) + "Client";
  // The user's own input, but credentials in it (userinfo, query) are masked
  const url = printable(JSON.stringify(String(endpoint.url)));

  const lines = [
    `import { Client${authorized ? "" : ", StreamableHTTPClientTransport"} } from "@modelcontextprotocol/client";`,
    ...(authorized
      ? [`import { browserAuth } from "oauth-callback/mcp";`]
      : []),
    importLine(factory, file!),
    ``,
    // Negotiate the newest protocol era, as generation did
    `const client = new Client({ name: "my-app", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });`,
    ...(authorized
      ? [
          `const auth = browserAuth({`,
          `  serverUrl: ${url},`,
          `  redirectUri: ${JSON.stringify(oauthRedirectUri(oauthPort))},`,
          `  clientName: "my-app",`,
          `});`,
          `await auth.connect(client); // opens the browser when needed`,
        ]
      : [
          `await client.connect(new StreamableHTTPClientTransport(new URL(${url})));`,
        ]),
    // Tool definitions let the SDK validate typed results and mirror x-mcp-header
    // arguments (ADR-003)
    ...(tools.length > 0 ? [`await client.listTools();`] : []),
    `const ${variable} = ${factory}(client);`,
  ];
  console.log(
    `\nUsage (npm install @modelcontextprotocol/client${authorized ? " oauth-callback" : ""}):\n`,
  );
  for (const line of lines) console.log(line ? `  ${line}` : "");
}

/**
 * Print only the factory for a config-mode client: connecting is the app's business
 * (including legacy SSE), and config URLs and headers may hold expanded secrets.
 */
function printConfigUsage({ name, file }: Target) {
  const factory = `create${clientTypeName(name)}`;
  console.log(`\nUsage for ${JSON.stringify(printable(name))}:\n`);
  for (const line of [
    importLine(factory, file!),
    ``,
    `// client: an @modelcontextprotocol/client Client connected to this server (see the factory's docs)`,
    `const ${camelCase(name)}Client = ${factory}(client);`,
  ])
    console.log(line ? `  ${line}` : "");
}

async function runUrlMode(mode: Extract<CliMode, { kind: "url" }>) {
  // Kept out of errors and the usage snippet, though the user typed them
  registerUrlCredentials(mode.url);
  const options = connectOptions(mode);
  const target: Target = {
    endpoint: { url: mode.url },
    name: extractServerName(mode),
    file: mode.output,
  };
  if (!target.file) {
    // Stdout: just the code
    process.stdout.write((await generate(target, options)).code);
    return;
  }
  const { code, snapshot } = await withSpinner(
    `Introspecting ${target.name}`,
    () => generate(target, options),
  );
  await writeModules([{ file: target.file!, code }]);
  console.log(`\nGenerated ${target.file}`);
  printUrlUsage(target, snapshot, mode.oauthPort);
}

/**
 * Config mode: one module per server, written only after every server succeeds. A failing server (e.g. an auth
 * outage) must not silently drop its client from the project, so nothing is written
 * unless every server succeeds. Servers are introspected one at a time: each may run a
 * browser flow on the same loopback port.
 */
async function runConfigMode(
  servers: ConfiguredServer[],
  outputDir: string,
  options: ConnectOptions,
) {
  if (outputDir.endsWith(".ts"))
    throw new Error(
      `Config mode writes one module per server; pass a directory, not "${outputDir}"`,
    );
  const targets: Target[] = servers.map((server) => {
    const name = extractServerName(server);
    return {
      endpoint: server,
      name,
      file: join(outputDir, moduleFileName(name)),
    };
  });

  // Distinct names must not share a file; check before introspecting (it may run OAuth)
  const byFile = Map.groupBy(targets, (t) => t.file!);
  const clashes = [...byFile].filter(([, group]) => group.length > 1);
  if (clashes.length > 0)
    throw new ListedError(
      "Server names collide in generated files. Rename them in your MCP config:",
      clashes.map(
        ([file, group]) =>
          `${group.map((t) => `"${printable(t.name)}"`).join(", ")} → ${printable(file)}`,
      ),
    );

  const results: Array<{ code: string; snapshot: ServerSnapshot }> = [];
  const failures: string[] = [];
  for (const target of targets) {
    try {
      results.push(
        await withSpinner(`Introspecting "${printable(target.name)}"`, () =>
          generate(target, options),
        ),
      );
    } catch (error) {
      failures.push(`"${printable(target.name)}": ${printable(error)}`);
    }
  }
  if (failures.length > 0)
    throw new ListedError(
      `${failures.length} of ${targets.length} server${targets.length === 1 ? "" : "s"} failed; no files written:`,
      failures,
    );

  await writeModules(
    targets.map((target, i) => ({
      file: target.file!,
      code: results[i]!.code,
    })),
  );
  console.log(`\nGenerated ${targets.map((t) => t.file).join(", ")}`);
  printConfigUsage(targets[0]!);
}

function connectOptions({ noOAuth, oauthPort }: AuthMode): ConnectOptions {
  return {
    oauth: noOAuth ? false : { redirectUri: oauthRedirectUri(oauthPort) },
  };
}

async function main() {
  let mode: CliMode;
  try {
    mode = parseArguments(process.argv.slice(2));
  } catch (error) {
    // parseArgs throws TypeErrors for unknown options and missing values. stderr keeps
    // stdout code-only for piped URL-mode output.
    console.error(`Error: ${printable(error)}`);
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
        await runConfigMode(
          setup.servers,
          setup.outputDir,
          connectOptions(mode),
        );
        return;
      }
    }
  } catch (error) {
    printError(error);
    process.exit(1);
  }
}

main();

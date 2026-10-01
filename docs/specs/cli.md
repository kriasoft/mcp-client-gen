# CLI Specification

Modes, arguments, output and exit codes of `mcp-client-gen`. Code: `src/cli.ts`, `src/prompts.ts`. Config files: SPEC-config. Generated code: SPEC-generated-client.

## Arguments

```
npx mcp-client-gen [source] [output] [options]

Arguments:
  <url>             MCP server URL (http:// or https://)
  [file]            URL mode: output file (default: stdout)
  [dir]             Config mode: output directory (implies -y)

Options:
  --url <url>          Explicit URL source (when the first positional can't be one)
  --name <name>        Client name (URL mode only): notion → createNotionClient
  -o, --output <path>  Output file (URL mode) or directory (config mode)
  --config <file>      Config file to read instead of discovery (config mode)
  -y, --yes            Accept defaults: all servers, default directory, no prompts
  -h, --help           Show help
```

## Mode Selection

In priority order:

1. `--help` → help on stdout, exit 0.
2. `--url <url>` → URL mode. Output: `-o`, else the first positional (if not a URL).
3. First positional starts with `http://` or `https://` → URL mode. Output: `-o`, else the second positional.
4. An output (`-o` or a non-URL positional), or `-y` → quick mode.
5. Otherwise → interactive mode.

An output means "no prompts" in config mode, so `-o dir` and a positional `dir` behave the same, as in URL mode.

## URL Mode (Primary)

```bash
npx mcp-client-gen https://mcp.notion.com/mcp                  # stdout
npx mcp-client-gen https://mcp.notion.com/mcp -o src/notion.ts # file
npx mcp-client-gen https://mcp.notion.com/mcp src/notion.ts    # same
npx mcp-client-gen --url https://mcp.example.com/mcp --name notion -o notion.ts
```

- **Connection:** Streamable HTTP, with browser OAuth when the server demands it (ADR-002).
- **Name:** `--name`, else derived from the URL (SPEC-generated-client).
- **Stdout:** carries the code only; no spinner, no usage text.
- **File:** the CLI shows a spinner, writes the file (creating directories), then prints the usage snippet.

## Config Modes

Config modes generate one module per selected server into an output directory, all or nothing (ADR-001):

1. **Module path:** `{dir}/{file}.ts`, where `{file}` is the kebab-case client name (`notion` → `notion.ts`, `GitHub` → `git-hub.ts`).
2. **Collisions:** servers whose names map to the same file are rejected before connecting.
3. **Sequential:** servers are introspected one at a time, since each may run a browser flow on the same loopback port.
4. **Failures:** if any server fails, nothing is written. Every failure is listed (redacted, labeled with the server name) and the exit code is 1.
5. **Output path:** an output ending in `.ts` is rejected; pass a directory.

### Interactive Mode

Triggered by `npx mcp-client-gen` with no arguments.

1. **Config files:** multiselect, all pre-selected; skipped with `--config`.
2. **Servers:** multiselect, all pre-selected. Labels show the entry name and a redacted URL hint.
3. **Output directory:** text input; default `src/mcp` if `src/` exists, else `mcp`.
4. **Generation:** a spinner per server, then the written files and usage snippet.

Ctrl+C or Esc at any prompt cancels with exit 0.

```
◆  Select MCP configuration files to use:
│  ◻ .mcp.json
◆  Select MCP servers to include:
│  ◻ notion (http · https://mcp.notion.com/mcp)
◇  Output directory (one module per server):
│  src/mcp
◇  Introspecting "notion"

Generated src/mcp/notion.ts
```

### Quick Mode

Triggered by `-y`, `-o <dir>` or a positional `<dir>`.

- **Files:** every discovered config file, or `--config`.
- **Servers:** every usable server.
- **Directory:** the given one, else the interactive default.

```
🚀 Using defaults: 2 servers → src/mcp/
◇  Introspecting "notion"
◇  Introspecting "github"

Generated src/mcp/notion.ts, src/mcp/github.ts
```

## Writing Files

1. **Formatting:** modules are formatted with the Prettier config that applies to their destination, so generated files match the project's style. The library API uses Prettier defaults instead.
2. **Staging:** each module is first written as a temp file beside its destination (`{file}.{pid}.tmp`), then all are renamed into place.
3. **Directory check:** a destination that is an existing directory is rejected before anything is written.
4. **Cleanup:** a failed write removes every temp file and leaves existing modules unchanged. Only a failing rename (e.g. an immutable file) can leave earlier modules replaced.

## Usage Snippet

After writing files, the CLI prints how to use the first module:

```
Usage (npm install @modelcontextprotocol/client oauth-callback):

  import { Client } from "@modelcontextprotocol/client";
  import { browserAuth } from "oauth-callback/mcp";
  import { createNotionClient } from "./src/mcp/notion.js";

  const client = new Client({ name: "my-app", version: "1.0.0" });
  const auth = browserAuth({ serverUrl: …, redirectUri: "http://127.0.0.1:3000/callback", clientName: "my-app" });
  await auth.connect(client); // opens the browser when needed
  const notionClient = createNotionClient(client);
```

- **Connection code:**
  - `browserAuth(…).connect(client)` (and `oauth-callback` in the install line) only when requests carried OAuth tokens during generation;
  - otherwise `client.connect(new StreamableHTTPClientTransport(new URL(…)))`;
  - `SSEClientTransport` for legacy SSE servers, plus a note on how to use OAuth with SSE when needed.
- **URL:** URL mode prints the URL given on the command line. Config mode never prints a config URL (it may hold expanded secrets); it prints `"..."` and names the entry instead (SPEC-config).
- **Import path:** relative to the working directory, `/`-separated, `.ts` → `.js`, JSON-quoted.
- **Variable:** `{camelCase(name)}Client`, so it is never a reserved word, `client` or `auth`.

## Streams and Exit Codes

- **Stdout:** generated code (URL mode without a file), progress, usage and help.
- **Stderr:** errors, config warnings, and help printed after an argument error.
- **Redaction:** every error message passes through `redactSecrets()` (SPEC-config).

| Code | Meaning                                                                                    |
| ---- | ------------------------------------------------------------------------------------------ |
| 0    | Success, `--help`, or a cancelled prompt                                                   |
| 1    | Argument error, missing config, no usable servers, a name collision, or any server failing |

# CLI Specification

Modes, arguments, output and exit codes of `mcp-client-gen`. Code: `src/cli.ts`, `src/prompts.ts`. Config files: SPEC-config. Generated code: SPEC-generated-client.

## Grammar

```
npx mcp-client-gen <url> [-o file] [--name name] [auth]   # URL mode
npx mcp-client-gen [--config file] [-y] [-o dir] [auth]   # config mode
# auth: --no-oauth | --oauth-port <port>
npx mcp-client-gen --help
```

| Option                | Mode   | Meaning                                                              |
| --------------------- | ------ | -------------------------------------------------------------------- |
| `<url>`               | URL    | MCP server URL; must parse as an `http:` or `https:` URL             |
| `-o, --output <path>` | both   | Output file (URL mode, default stdout) or directory (config mode)    |
| `--name <name>`       | URL    | Client name: `notion` → `createNotionClient` (default: from the URL) |
| `--config <file>`     | config | Config file to read instead of discovery                             |
| `-y, --yes`           | config | All servers, default directory, no prompts                           |
| `--no-oauth`          | both   | Never open a browser: a server demanding OAuth fails (e.g. in CI)    |
| `--oauth-port <port>` | both   | OAuth redirect `http://127.0.0.1:<port>/callback` (default 3000)     |
| `-h, --help`          | —      | Help on stdout, exit 0                                               |

Anything outside the grammar is an error (stderr, help, exit 1), never ignored:

- an unknown option, or an option missing its value;
- a second positional;
- a positional that isn't an http(s) URL;
- `--config` or `-y` with a URL;
- `--name` in config mode;
- `--oauth-port` outside 1–65535, or with `--no-oauth`.

The single positional decides the mode: a URL selects URL mode, none selects config mode. Config mode prompts unless `-y` or `-o` is given (quick mode).

## URL Mode (Primary)

```bash
npx mcp-client-gen https://mcp.notion.com/mcp                  # stdout
npx mcp-client-gen https://mcp.notion.com/mcp -o src/notion.ts # file
npx mcp-client-gen https://mcp.example.com/mcp --name notion -o notion.ts
```

- **Connection:** Streamable HTTP, with browser OAuth when the server demands it (ADR-002).
- **Name:** `--name`, else derived from the URL (SPEC-generated-client).
- **Stdout:** carries the code only; no spinner, no usage text.
- **File:** the CLI shows a spinner, writes the file (creating directories), then prints the usage snippet.

## Config Modes

Config modes generate one module per selected server into an output directory, only after every server succeeds (ADR-001):

1. **Module path:** `{dir}/{file}.ts`, where `{file}` is the kebab-case client name (`notion` → `notion.ts`, `GitHub` → `git-hub.ts`).
2. **Collisions:** servers whose names map to the same file are rejected before connecting.
3. **Sequential:** servers are introspected one at a time, since each may run a browser flow on the same loopback port.
4. **Failures:** if any server fails, nothing is written. Every failure is listed (redacted, labeled with the server name) and the exit code is 1.
5. **Output path:** an output ending in `.ts` is rejected; pass a directory.

### Interactive Mode

Triggered by config mode without `-y` or `-o` (optionally with `--config`).

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

Triggered by `-y` or `-o <dir>`.

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

After writing a file, URL mode prints how to connect and use it:

```
Usage (npm install @modelcontextprotocol/client oauth-callback):

  import { Client } from "@modelcontextprotocol/client";
  import { browserAuth } from "oauth-callback/mcp";
  import { createNotionClient } from "./src/mcp/notion.js";

  const client = new Client({ name: "my-app", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
  const auth = browserAuth({ serverUrl: …, redirectUri: "http://127.0.0.1:3000/callback", clientName: "my-app" }); // --oauth-port's
  await auth.connect(client); // opens the browser when needed
  await client.listTools();
  const notionClient = createNotionClient(client);
```

Config mode prints only the first module's import and factory call, labeled with its entry name (`Usage for "notion":`): connecting is the app's business, and a config's URL and headers may hold expanded secrets (SPEC-config). The factory's JSDoc carries the connection requirements (SPEC-generated-client).

- **Connection code:**
  - `browserAuth(…).connect(client)` (and `oauth-callback` in the install line) only when requests carried OAuth tokens during generation;
  - otherwise `client.connect(new StreamableHTTPClientTransport(new URL(…)))`.
  - URL mode is always Streamable HTTP; legacy SSE servers come from config, whose snippet shows no connection code.
- **Tools:** when the module has tools, the snippet calls `client.listTools()` once, so the SDK validates `structuredContent` and sends `x-mcp-header` arguments as headers (ADR-003).
- **URL:** the URL given on the command line, with its userinfo and query values masked (`?token=***`); they are registered as secrets, so errors mask them too.
- **Protocol:** snippets opt into version negotiation (`versionNegotiation: { mode: "auto" }`), matching generation; the SDK's default is the legacy 2025 era.
- **Import path:** relative to the working directory, `/`-separated, `.ts` → `.js`, JSON-quoted.
- **Variable:** `{camelCase(name)}Client`, so it is never a reserved word, `client` or `auth`.

## Streams and Exit Codes

- **Stdout:** generated code (URL mode without a file), progress, usage and help.
- **Stderr:** errors, config warnings, and help printed after an argument error.
- **Printing:** errors (any thrown value), warnings and config entry names pass through `printable()`, which keeps a value on one line: line breaks and tabs become spaces (a server's error can't fake output lines), other control and bidi characters are stripped (terminal escapes, reordered text), then secrets are masked (SPEC-config). Multi-line errors (failed servers, colliding names) are the CLI's layout around such values.

| Code | Meaning                                                                                    |
| ---- | ------------------------------------------------------------------------------------------ |
| 0    | Success, `--help`, or a cancelled prompt                                                   |
| 1    | Argument error, missing config, no usable servers, a name collision, or any server failing |

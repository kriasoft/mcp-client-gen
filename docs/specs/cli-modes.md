# CLI Modes Specification

Defines the execution modes and their behavior.

## Mode Selection

```
npx mcp-client-gen [source] [output] [options]

Mode determination (priority order):
  1. --help flag → show help, exit
  2. --url flag provided → URL mode
  3. First positional starts with http:// or https:// → URL mode
  4. Output (-o or positional, not URL) → Quick mode with that directory
  5. -y/--yes flag → Quick mode (config-based)
  6. No args → Interactive mode (config-based)
```

## URL Mode (Primary)

Triggered: `npx mcp-client-gen <url>` or `npx mcp-client-gen --url <url>`

Generates client from a remote MCP server URL. No config files needed.

```bash
# Output to stdout (default)
npx mcp-client-gen https://api.notion.com/mcp

# Output to file
npx mcp-client-gen https://api.notion.com/mcp -o notion.ts
npx mcp-client-gen https://api.notion.com/mcp notion.ts

# With explicit name
npx mcp-client-gen https://api.notion.com/mcp --name notion -o notion.ts

# Explicit URL flag (escape hatch for edge cases like http-client.ts)
npx mcp-client-gen --url https://api.notion.com/mcp
```

Behavior:

- Connect to MCP server via Streamable HTTP (browser OAuth if the server demands it)
- Introspect tools, resources, prompts
- Generate TypeScript client
- Output: stdout by default (code only), file if `-o` or second positional provided; a file gets a usage snippet (SDK `Client`, plus `oauth-callback` when the server used OAuth)
- Server name: `--name` flag or inferred from URL hostname

## Config Modes

Config modes generate one module per selected server into an output directory (`{dir}/{server}.ts`, kebab-case of the client name), all or nothing (ADR-001):

- Servers whose names map to the same file are rejected before connecting.
- Servers are introspected one at a time (each may run a browser flow on the same loopback port).
- If any server fails, nothing is written: the errors are listed and the exit code is 1.
- An output ending in `.ts` is rejected: pass a directory.

### Interactive Mode

Triggered: `npx mcp-client-gen` (no arguments)

1. Display intro banner
2. Prompt for config files (multiselect, all pre-selected)
3. Prompt for servers (multiselect, all pre-selected)
4. Prompt for output directory (text input with smart default)
5. Generate with a progress spinner per server
6. Display written files and usage instructions

User can cancel at any prompt (Ctrl+C or Esc).

```
npx mcp-client-gen

◆  MCP Client Generator
│
◆  Select MCP configuration files to use:
│  ◻ .mcp.json
│
◆  Select MCP servers to include:
│  ◻ notion (http · https://mcp.notion.com/mcp)
│
◇  Output directory (one module per server):
│  src/mcp
│
◇  Configuration complete! Generating 1 client
◇  Introspecting "notion"

Generated src/mcp/notion.ts
```

### Quick Mode

Triggered: `npx mcp-client-gen -y`, `-o <dir>`, or a positional `<dir>`

- Use all discovered config files (or `--config <file>`)
- Include all servers from configs
- Output directory: the given one, else `src/mcp` if `src/` exists, else `mcp`

```
npx mcp-client-gen -y

🚀 Using defaults: 2 servers → src/mcp/
◇  Introspecting "notion"
◇  Introspecting "github"

Generated src/mcp/notion.ts, src/mcp/github.ts
```

Error cases:

- Config file not found → error with suggestion
- No valid servers in config → error

## CLI Arguments

```
Arguments:
  <url>             MCP server URL (http:// or https://)
  [file]            URL mode: output file (default: stdout)
  [dir]             Config mode: output directory (implies -y)

Options:
  --url <url>       Explicit URL source (escape hatch for edge cases)
  --name <name>     Override server name (URL mode only)
  -o, --output <path>  Output file (URL mode) or directory (config mode)
  --config <file>   Path to MCP configuration file
  -y, --yes         Accept defaults, skip prompts
  -h, --help        Show this help message
```

## Config Discovery Order

Paths searched (in priority order):

```
.mcp.local.json      # Local overrides (gitignored)
.mcp.json            # Claude format
.cursor/mcp.local.json
.cursor/mcp.json     # Cursor format
.vscode/mcp.local.json
.vscode/mcp.json     # VS Code format
```

Earlier files take priority: the first usable entry claims its server name and its URL, and later entries with either are dropped. So a `.local` entry overrides its shared counterpart even when the URLs differ, and a server listed by several tools is generated once. Skipped entries (stdio, missing URL, unresolved env) claim nothing.

## Config Formats

### Claude / Cursor Format

```json
{
  "mcpServers": {
    "notion": {
      "type": "http",
      "url": "https://mcp.notion.com/mcp",
      "headers": {
        "Authorization": "Bearer ${API_KEY}"
      }
    }
  }
}
```

### VS Code Format (flat)

```json
{
  "servers": {
    "notion": {
      "type": "http",
      "url": "https://mcp.notion.com/mcp"
    }
  }
}
```

### VS Code Format (nested)

```json
{
  "mcp": {
    "servers": {
      "notion": {
        "type": "http",
        "url": "https://mcp.notion.com/mcp",
        "headers": {
          "X-API-Key": "${env:API_KEY}"
        }
      }
    }
  }
}
```

### Type Inference

| Config State                         | Inferred Type |
| ------------------------------------ | ------------- |
| `type: "http"`                       | `http`        |
| `type: "sse"`                        | `sse`         |
| `type: "stdio"` or `command` present | skipped       |
| No `type`, has `url`                 | `http`        |

## Exit Codes

| Code | Meaning                                                |
| ---- | ------------------------------------------------------ |
| 0    | Success                                                |
| 1    | Error (missing config, no servers, any server failing) |

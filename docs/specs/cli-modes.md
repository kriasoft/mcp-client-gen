# CLI Modes Specification

Defines the execution modes and their behavior.

## Mode Selection

```
npx mcp-client-gen [source] [output] [options]

Mode determination (priority order):
  1. --help flag → show help, exit
  2. --url flag provided → URL mode
  3. First positional starts with http:// or https:// → URL mode
  4. Positional provided (not URL) → Direct mode (config-based)
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

- Connect to MCP server via HTTP/SSE transport
- Introspect tools, resources, prompts
- Generate TypeScript client
- Output: stdout by default, file if `-o` or second positional provided
- Server name: `--name` flag or inferred from URL hostname

## Interactive Mode

Triggered: `npx mcp-client-gen` (no arguments)

Config-based generation with user prompts.

Flow:

1. Display intro banner
2. Prompt for config files (multiselect, all pre-selected)
3. Prompt for servers (multiselect, all pre-selected)
4. Prompt for output path (text input with smart default)
5. Generate client with progress spinner
6. Display summary and usage instructions

User can cancel at any prompt (Ctrl+C or Esc).

```
npx mcp-client-gen

◆  MCP Client Generator
│
◆  Select MCP configuration files to use:
│  ◻ .mcp.json
│  ◻ .cursor/mcp.json
│
◆  Select MCP servers to include:
│  ◻ https://mcp.notion.com/mcp (Type: http)
│
◇  Enter output file path:
│  src/mcp-client.ts
│
◇  Configuration complete! Generating client for 1 server
│
◐  Introspecting 1 MCP server...
◇  Introspected 1 server: 12 tools, 1 resource

Generated client saved to src/mcp-client.ts
```

## Quick Mode

Triggered: `npx mcp-client-gen -y` or `npx mcp-client-gen --yes`

Config-based generation with defaults (no prompts).

Behavior:

- Use all discovered config files
- Include all servers from configs
- Auto-detect output path: `src/mcp-client.ts` if `src/` exists, else `mcp-client.ts`
- No prompts, immediate generation

```
npx mcp-client-gen -y

🚀 Using defaults: 1 server → src/mcp-client.ts
◐  Introspecting 1 MCP server...
◇  Introspected 1 server: 12 tools, 1 resource

Generated client saved to src/mcp-client.ts
```

## Direct Mode

Triggered: `npx mcp-client-gen <output-file>` (where output-file is not a URL)

Config-based generation with explicit output path.

Behavior:

- Require explicit output path
- Use discovered config files (or `--config` path)
- Include all servers from config
- No prompts (fail on missing config)

```bash
npx mcp-client-gen ./src/mcp-client.ts
npx mcp-client-gen --config custom.mcp.json ./src/mcp.ts
```

Error cases:

- Config file not found → error with suggestion
- No valid servers in config → error

## CLI Arguments

```
Arguments:
  <url>             MCP server URL (http:// or https://)
  [output]          Output file path (default: stdout for URL mode)

Options:
  --url <url>       Explicit URL source (escape hatch for edge cases)
  --name <name>     Override server name (URL mode only)
  -o, --output <file>  Output file path
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

## Output Path Defaults

Smart default based on project structure:

```typescript
const srcExists = existsSync(resolve(cwd, "src"));
const defaultPath = srcExists ? "src/mcp-client.ts" : "mcp-client.ts";
```

Validation:

- Path must end with `.ts`
- Path must not be empty

## Exit Codes

| Code | Meaning                                                |
| ---- | ------------------------------------------------------ |
| 0    | Success                                                |
| 1    | Error (missing config, no servers, generation failure) |

# Config Specification

How config mode finds MCP servers in editor/agent config files. Code: `src/config.ts`. Decisions: ADR-005.

Config parsing is CLI-only; the public API takes a server directly.

## Discovery

Without `--config`, these paths are checked relative to the working directory, in priority order:

```
.mcp.local.json          # personal overrides (gitignore it)
.mcp.json                # Claude Code
.cursor/mcp.local.json
.cursor/mcp.json         # Cursor
.vscode/mcp.local.json
.vscode/mcp.json         # VS Code
```

`--config <file>` uses that one file instead. Interactive mode lets the user deselect discovered files.

## Precedence

Files are read in priority order. The first **usable** entry claims both its name and its connection (type, URL and headers). Later entries with either the same name or the same connection are dropped silently.

- **By name**, so a `.local` entry overrides its shared counterpart even when the URLs differ.
- **By connection**, so a server listed in several tools' configs is generated once. URLs compare as fetch sends them (`https://X.com:443` = `https://x.com/`), header names case-insensitively. One URL with different headers (e.g. two accounts) stays two servers.
- **Skipped entries** (below) claim nothing, so a broken override falls back to the shared entry, with a warning.

## File Format

Every file is parsed as **JSONC**:

- `//` and `/* */` comments, trailing commas, a UTF-8 BOM and CR line endings are accepted;
- an unterminated comment is an error.

The scanner avoids Bun-only APIs because the CLI runs on Node.

The servers object is the first present of:

- `mcpServers` (Claude Code, Cursor);
- `servers` (VS Code);
- `mcp.servers` (VS Code settings style).

```jsonc
// .mcp.json (Claude Code / Cursor)
{
  "mcpServers": {
    "notion": { "url": "https://mcp.notion.com/mcp" },
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/",
      "headers": { "Authorization": "Bearer ${GITHUB_TOKEN}" },
    },
    "legacy": {
      "type": "sse",
      "url": "${API_BASE:-https://api.example.com}/sse",
    },
  },
}
```

```jsonc
// .vscode/mcp.json
{
  "inputs": [{ "type": "promptString", "id": "key", "password": true }],
  "servers": {
    "docs": {
      "url": "https://docs.example.com/mcp",
      "headers": { "X-API-Key": "${env:DOCS_KEY}" },
    },
    "local": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "some-server"],
    }, // skipped
  },
}
```

Upstream references: [Claude Code](https://docs.anthropic.com/en/docs/claude-code/mcp), [Cursor](https://docs.cursor.com/en/context/mcp), [VS Code](https://code.visualstudio.com/docs/copilot/chat/mcp-servers).

## Entries

| Entry                                       | Result                            |
| ------------------------------------------- | --------------------------------- |
| `type: "http"`, or no `type` with a `url`   | Streamable HTTP server            |
| `type: "sse"`                               | legacy SSE server                 |
| `type: "stdio"`, or a `command`             | skipped: `skipped_stdio`          |
| any other `type`                            | skipped: `unknown_type`           |
| no `url` (after expansion and trimming)     | skipped: `missing_url`            |
| a `url` that isn't an `http:`/`https:` URL  | skipped: `invalid_url`            |
| unresolvable placeholder in `url`/`headers` | skipped: `unresolved_placeholder` |

- **Server name:** the config key. An empty key becomes `server`; a name is never derived from a URL, which may hold an expanded secret.
- **Header values:** non-string values are stringified.

## Environment Placeholders

Placeholders expand from `process.env` in `url` and header values:

| Syntax              | Source              | Behavior                                        |
| ------------------- | ------------------- | ----------------------------------------------- |
| `${env:NAME}`       | VS Code, Cursor     | value of `NAME`                                 |
| `${NAME}`           | Claude Code         | value of `NAME`                                 |
| `${NAME:-fallback}` | Claude Code (shell) | value of `NAME`, or `fallback` when unset/empty |

The server is skipped with an `unresolved_placeholder` warning that lists the placeholder **names** (`API_KEY`, `input:key`), never values, when any placeholder:

- names an unset variable without a fallback;
- isn't an environment reference (e.g. VS Code's `${input:id}`);
- has an invalid name;
- has a fallback containing another placeholder.

A literal placeholder is never sent as a URL or credential.

## Warnings

`getMcpServers()` returns `{ servers, warnings }`. Warnings are structured (`ConfigWarning`) and printed to stderr by the CLI, even when other servers remain:

| Kind                     | Fields                                   |
| ------------------------ | ---------------------------------------- |
| `malformed_json`         | `path`, `error` (also a non-object root) |
| `skipped_stdio`          | `path`, `name`                           |
| `missing_url`            | `path`, `name`                           |
| `invalid_url`            | `path`, `name`                           |
| `unknown_type`           | `path`, `name`, `type`                   |
| `unresolved_placeholder` | `path`, `name`, `placeholders`           |

One malformed file doesn't stop the others from loading.

## Secret Redaction

Expanded values (including fallbacks) and literal credentials (every header value; the userinfo and query values of a literal URL) are treated as secrets, because SDK errors, servers' error pages and labels echo URLs and headers. The host and path of a literal URL stay readable.

- **Masking:** messages built from config values or SDK errors (failures, error output, server hints) go through `redactSecrets()`, which masks every registered form of each value:
  - raw, trimmed and lowercased;
  - URL path, query and component encodings;
  - HTML and JSON escapes (including Go's HTML-safe JSON);
  - for a URL containing a placeholder, its href, host, path, query, query values, userinfo and every path segment (a `/` inside a secret splits it across segments).
- **Precision:** overlapping matches merge before masking; forms shorter than 4 characters are ignored, so unrelated text isn't mangled.
- **Names over URLs:** failures and the usage snippet name the entry instead of printing its URL. Interactive mode shows each server's URL only as a redacted hint.
- **Warnings** carry file names, entry names, placeholder names and parse errors of the raw file, which can't contain expanded values; like all CLI output they are printed through `printable()`, which also strips control characters.
- **Limits:** masking is best effort for common serializations; a server that transforms a secret (e.g. base64) bypasses it.

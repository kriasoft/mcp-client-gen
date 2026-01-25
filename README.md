# MCP Client Generator

Generate type-safe TypeScript clients from [MCP](https://modelcontextprotocol.io) servers.

## Quick Start

```bash
# Generate client from URL
npx mcp-client-gen https://mcp.notion.com/mcp -o notion.ts

# Use the generated client
```

```typescript
import { createNotionClient } from "./notion";
import { createMcpConnection } from "mcp-client-gen";

const connection = await createMcpConnection({
  url: "https://mcp.notion.com/mcp",
});

const notion = createNotionClient(connection);

// Fully typed based on server schema
const pages = await notion.notionSearch({ query: "Meeting Notes" });
```

## Features

- **Type-safe** — Generated TypeScript types from server schemas
- **Zero config auth** — OAuth 2.1 with PKCE, just approve in browser
- **Tree-shakable** — Only bundle the methods you import

## Installation

```bash
npm install -g mcp-client-gen
# or
bun add -g mcp-client-gen
```

## CLI Usage

```bash
# URL mode (primary)
npx mcp-client-gen <url>              # Output to stdout
npx mcp-client-gen <url> -o <file>    # Output to file
npx mcp-client-gen <url> <file>       # Shorthand

# Config mode (reads .mcp.json, .cursor/, .vscode/)
npx mcp-client-gen                    # Interactive
npx mcp-client-gen -y                 # Accept defaults
```

### Config File Format

```jsonc
// .mcp.json
{
  "mcpServers": {
    "notion": { "url": "https://mcp.notion.com/mcp" },
    "github": { "url": "https://api.githubcopilot.com/mcp/" },
  },
}
```

## Authentication

No credentials required. OAuth-protected servers trigger automatic browser authentication via Dynamic Client Registration (RFC 7591) and PKCE.

## License

MIT — [Konstantin Tarkus](https://github.com/koistya)

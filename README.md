# MCP Client Generator

[![npm](https://img.shields.io/npm/v/mcp-client-gen)](https://www.npmjs.com/package/mcp-client-gen)
[![downloads](https://img.shields.io/npm/dw/mcp-client-gen)](https://www.npmjs.com/package/mcp-client-gen)
[![Discord](https://img.shields.io/discord/643523529131950086?label=Chat)](https://discord.gg/bSsv7XM)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

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
  type: "http",
  url: "https://mcp.notion.com/mcp",
});

const notion = createNotionClient(connection);

// Fully typed based on server schema
const pages = await notion.notionSearch({ query: "Meeting Notes" });
```

## Features

- **Type-safe** — Generated TypeScript types from server schemas
- **Zero config auth** — OAuth 2.1 with PKCE, just approve in browser
- **Tree-shakable** — One class per server; bundles include only the clients you use

## Installation

```bash
npm install -g mcp-client-gen
# or
bun add -g mcp-client-gen
```

Requires Node.js 22+ (or Bun). Projects that use generated clients also need `@modelcontextprotocol/client` 2.x.

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

No credentials required. OAuth-protected servers trigger automatic browser authentication via Dynamic Client Registration (RFC 7591) and PKCE, using the loopback redirect `http://127.0.0.1:3000/callback`.

Credentials live in memory by default. To persist them, give each server its own file:

```typescript
import { createMcpConnection, fileStore } from "mcp-client-gen";

const connection = await createMcpConnection(server, {
  oauth: {
    store: (server) =>
      fileStore(
        `/home/me/.config/my-app/${encodeURIComponent(server.url)}.json`,
      ),
  },
});
```

If a server later demands authorization again, e.g. more scopes (step-up, Streamable HTTP only), the request fails with `UnauthorizedError`. Call `connection.authorize()` to finish the browser flow, then retry:

```typescript
import { UnauthorizedError } from "@modelcontextprotocol/client";

try {
  await notion.notionSearch({ query: "Meeting Notes" });
} catch (error) {
  if (!(error instanceof UnauthorizedError)) throw error;
  await connection.authorize();
  await notion.notionSearch({ query: "Meeting Notes" });
}
```

## License

MIT — [Konstantin Tarkus](https://github.com/koistya)

# MCP Client Generator

[![npm](https://img.shields.io/npm/v/mcp-client-gen)](https://www.npmjs.com/package/mcp-client-gen)
[![downloads](https://img.shields.io/npm/dw/mcp-client-gen)](https://www.npmjs.com/package/mcp-client-gen)
[![Discord](https://img.shields.io/discord/643523529131950086?label=Chat)](https://discord.gg/bSsv7XM)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Generate type-safe TypeScript clients from [MCP](https://modelcontextprotocol.io) servers.

## Quick Start

```bash
# Generate a client module from a server URL (approve OAuth in the browser if asked)
npx mcp-client-gen https://mcp.notion.com/mcp -o src/notion.ts

# Runtime dependencies: the MCP SDK, plus oauth-callback for OAuth servers
npm install @modelcontextprotocol/client oauth-callback
```

```typescript
import { Client } from "@modelcontextprotocol/client";
import { browserAuth } from "oauth-callback/mcp";
import { createNotionClient } from "./notion";

const client = new Client(
  { name: "my-app", version: "1.0.0" },
  { versionNegotiation: { mode: "auto" } }, // speak MCP 2026-07-28 when the server does
);
const auth = browserAuth({
  serverUrl: "https://mcp.notion.com/mcp",
  redirectUri: "http://127.0.0.1:3000/callback",
  clientName: "my-app",
});
await auth.connect(client);
await client.listTools(); // lets the SDK validate typed results and send tool headers

const notion = createNotionClient(client);

// Typed input; the result is the SDK's CallToolResult
const result = await notion.search({ query: "Meeting Notes" });
```

Servers without OAuth connect with the SDK alone: `await client.connect(new StreamableHTTPClientTransport(new URL(url)))`. After writing a file, the CLI prints the snippet for your server.

Tools that declare an output schema return a typed `structuredContent` once `isError` is ruled out:

```typescript
const result = await github.searchIssues({ query: "is:open" });
if (result.isError) throw new Error("search failed");
result.structuredContent.items; // typed from the tool's outputSchema
```

## Features

- **Type-safe** — Generated TypeScript types from tool schemas, typed parameters for resource templates
- **Thin** — Generated methods delegate to the official SDK `Client` and return its results unchanged
- **No runtime dependency on this package** — Generated modules import only SDK types
- **Zero config auth** — OAuth 2.1 with PKCE during generation, just approve in browser

## Installation

`mcp-client-gen` is a development tool: run it with `npx`, or install it as a dev dependency to regenerate clients in a script. Generated modules need only `@modelcontextprotocol/client` ^2.2. Requires Node.js 22+ (or Bun).

A generated module is a snapshot of the server's tools, prompts and resources, under the protocol revision negotiated during generation: regenerate when the server changes. If its result types depend on that revision, the factory throws for a `Client` that negotiated another.

## CLI Usage

```bash
# URL mode (primary)
npx mcp-client-gen <url>              # Output to stdout
npx mcp-client-gen <url> -o <file>    # Output to file

# Config mode (reads .mcp.json, .cursor/, .vscode/): one module per server
npx mcp-client-gen                    # Interactive
npx mcp-client-gen -y                 # All servers → src/mcp/ (or mcp/)
npx mcp-client-gen -o <dir>           # All servers → <dir> (implies -y)

# Either mode
npx mcp-client-gen ... --no-oauth     # Never open a browser: fail instead (e.g. in CI)
```

Config mode writes only after every server succeeds: if any server fails, it lists the errors and leaves your files untouched.

### Config File Format

```jsonc
// .mcp.json
{
  "mcpServers": {
    "notion": { "url": "https://mcp.notion.com/mcp" },
    "github": {
      "url": "https://api.githubcopilot.com/mcp/",
      "headers": { "Authorization": "Bearer ${GITHUB_TOKEN}" },
    },
  },
}
```

Config files may contain comments and trailing commas. `${NAME}`, `${NAME:-default}` and `${env:NAME}` in `url` and `headers` expand from the environment; a server with an unresolved placeholder is skipped with a warning.

## Authentication

During generation, OAuth-protected servers trigger browser authentication via the MCP SDK and [oauth-callback](https://github.com/kriasoft/oauth-callback): discovery, PKCE, and Dynamic Client Registration unless you pass a pre-registered `clientInformation`. The loopback redirect is `http://127.0.0.1:3000/callback` (`oauth.redirectUri` changes it). Credentials live in memory for that run.

In your app, auth belongs to the `Client` you connect. With `browserAuth()`, pass a `store` to persist credentials (one file per server), and if a server later demands more scopes (step-up), the request fails with `UnauthorizedError`; call `auth.connect(client)` again to finish the browser flow, then retry:

```typescript
import { UnauthorizedError } from "@modelcontextprotocol/client";
import { browserAuth, fileStore } from "oauth-callback/mcp";

const auth = browserAuth({
  serverUrl: "https://mcp.notion.com/mcp",
  redirectUri: "http://127.0.0.1:3000/callback",
  clientName: "my-app",
  store: fileStore("/home/me/.config/my-app/notion.json"),
});
await auth.connect(client);

try {
  await notion.search({ query: "Meeting Notes" });
} catch (error) {
  if (!(error instanceof UnauthorizedError)) throw error;
  await auth.connect(client);
  await notion.search({ query: "Meeting Notes" });
}
```

## Programmatic API

```typescript
import { generateClient } from "mcp-client-gen";

const code = await generateClient("https://mcp.notion.com/mcp");
// or: generateClient({ url, name: "notion", headers: { ... } }, { oauth, fetch, timeout, signal })
// oauth: false fails rather than opening a browser (e.g. in CI)
```

`generateClient()` returns the formatted module source; it writes nothing.

## License

MIT — [Konstantin Tarkus](https://github.com/koistya)

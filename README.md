# MCP Client Generator

[![npm](https://img.shields.io/npm/v/mcp-client-gen)](https://www.npmjs.com/package/mcp-client-gen)
[![downloads](https://img.shields.io/npm/dw/mcp-client-gen)](https://www.npmjs.com/package/mcp-client-gen)
[![Discord](https://img.shields.io/discord/643523529131950086?label=Chat)](https://discord.gg/bSsv7XM)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Generate a typed TypeScript client for a remote [MCP](https://modelcontextprotocol.io) server (Streamable HTTP or SSE): point it at a URL, get a module with one method per tool.

```typescript
await notion.search({ query: "Meeting Notes" }); // instead of client.callTool({ name: "notion-search", arguments: … })
```

- **Typed** — inputs and outputs come from the server's JSON Schemas
- **Thin** — each method calls the official MCP SDK and returns its result unchanged
- **No lock-in** — generated code imports only SDK types, never this package
- **OAuth handled** — if the server asks, approve in the browser and generation continues

## Quick Start

**1. Generate** a module from the server's URL:

```bash
npx mcp-client-gen https://mcp.notion.com/mcp -o src/notion.ts
```

**2. Install** the MCP SDK (and `oauth-callback` if the server uses OAuth):

```bash
npm install @modelcontextprotocol/client oauth-callback
```

**3. Connect** an SDK `Client` and wrap it:

```typescript
import { Client } from "@modelcontextprotocol/client";
import { browserAuth } from "oauth-callback/mcp";
import { createNotionClient } from "./notion.js";

const client = new Client(
  { name: "my-app", version: "1.0.0" },
  { versionNegotiation: { mode: "auto" } }, // use the newest protocol the server speaks
);
const auth = browserAuth({
  serverUrl: "https://mcp.notion.com/mcp",
  redirectUri: "http://127.0.0.1:3000/callback",
  clientName: "my-app",
});
await auth.connect(client); // opens the browser when needed
await client.listTools(); // once: lets the SDK validate typed results

const notion = createNotionClient(client);
const result = await notion.search({ query: "Meeting Notes" });
```

No OAuth? Connect with the SDK alone: `await client.connect(new StreamableHTTPClientTransport(new URL(url)))`. The CLI prints the right snippet for your server after writing the file.

## Using the Client

Tools are methods. Results are the SDK's `CallToolResult`; when a tool declares an output schema, `structuredContent` is typed once you've checked `isError`:

```typescript
const result = await github.searchIssues({ query: "is:open" });
if (result.isError) throw new Error("search failed");
result.structuredContent.items; // typed
```

Prompts and resources, when the server has them, live in namespaces:

```typescript
await github.prompts.summarizePr({ number: "42" });
await github.resources.read("repo://octo/app/README.md"); // any URI
await github.resources.issue({ owner: "octo", number: "42" }); // a URI template, filled in
```

In tests, pass a plain object instead of a real `Client`: the factory needs only the methods it calls.

```typescript
const notion = createNotionClient({
  callTool: async () => ({ content: [{ type: "text", text: "stub" }] }),
  getPrompt: async () => ({ messages: [] }),
  readResource: async () => ({ contents: [] }),
});
```

## Keeping It in Sync

A generated module is a snapshot of the server's tools, prompts and resources. Regenerate when they change. Re-running on an unchanged server produces an identical file, so diffs show exactly what changed.

Connect your app the way generation did (`versionNegotiation: { mode: "auto" }` above). In the rare case where result types depend on the protocol version, the factory throws a clear error for a `Client` that negotiated a different one.

## CLI

```bash
npx mcp-client-gen <url>                     # print the module to stdout
npx mcp-client-gen <url> -o src/notion.ts    # write it to a file
npx mcp-client-gen <url> --name notion       # name it: createNotionClient (default: from the URL)

npx mcp-client-gen                           # pick servers from your MCP config files
npx mcp-client-gen -y                        # all of them → src/mcp/ (or mcp/)
npx mcp-client-gen -o <dir>                  # all of them → <dir>
npx mcp-client-gen --config <file>           # read this config file instead

npx mcp-client-gen ... --no-oauth            # never open a browser; fail instead (e.g. in CI)
npx mcp-client-gen ... --oauth-port 8080     # OAuth redirect port, if 3000 is taken
```

Without a URL, the CLI reads `.mcp.json`, `.cursor/mcp.json` and `.vscode/mcp.json` (a `.local.json` beside each takes precedence; [details](docs/specs/config.md)), skips local stdio servers, and writes one module per server. Files are written only if every server succeeds.

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

`${NAME}`, `${NAME:-default}` and `${env:NAME}` expand from the environment. A server with a missing variable is skipped with a warning.

## Authentication

**While generating,** an OAuth server opens your browser to approve access (redirect: `http://127.0.0.1:3000/callback`). Credentials are kept in memory for that run only.

**In your app,** auth belongs to the `Client` you connect. With `browserAuth()`, pass a `store` to remember credentials. If a server later asks for more permissions, the call throws `UnauthorizedError`; run `auth.connect(client)` again, then retry:

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
import { generateClientModule } from "mcp-client-gen";

const source = await generateClientModule("https://mcp.notion.com/mcp", {
  name: "notion",
});
```

It returns the module's source and writes nothing. Pass `{ url, transport, headers }` instead of a URL for headers or legacy SSE. Options: `name`, `oauth` (`false` to never open a browser), `fetch`, `timeout`, `signal`. Details: [docs/specs/api.md](docs/specs/api.md).

## Requirements

Node.js 22+ (or Bun) to generate. Generated modules need `@modelcontextprotocol/client` ^2.2; with TypeScript 6+, add `"types": ["node"]` to your `tsconfig.json` (the SDK's types use Node's `Buffer`).

## License

MIT — [Konstantin Tarkus](https://github.com/koistya)

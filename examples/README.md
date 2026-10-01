# Examples

- `notion-client.ts`: the client generated for the [Notion MCP server](https://mcp.notion.com/mcp) (`npx mcp-client-gen https://mcp.notion.com/mcp -o notion-client.ts`). Regenerate it from `test/fixtures/notion/introspection.json` with `bun capture:notion --from-fixtures`, or capture fresh fixtures with `bun capture:notion`.

```typescript
import { Client } from "@modelcontextprotocol/client";
import { browserAuth } from "oauth-callback/mcp";
import { createNotionClient } from "./notion-client";

const client = new Client(
  { name: "my-app", version: "1.0.0" },
  { versionNegotiation: { mode: "auto" } }, // speak MCP 2026-07-28 when the server does
);
await browserAuth({
  serverUrl: "https://mcp.notion.com/mcp",
  redirectUri: "http://127.0.0.1:3000/callback",
  clientName: "my-app",
}).connect(client);
const notion = createNotionClient(client);

const result = await notion.notionSearch({ query: "meeting notes" });
for (const block of result.content) {
  if (block.type === "text") console.log(block.text);
}

await client.close();
```

Generated clients import types from `@modelcontextprotocol/client` 2.x only, so projects using them need it installed.

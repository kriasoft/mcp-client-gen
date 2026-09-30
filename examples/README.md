# Examples

- `notion-client.ts`: the client generated for the [Notion MCP server](https://mcp.notion.com/mcp) (`npx mcp-client-gen https://mcp.notion.com/mcp -o notion-client.ts`). It's regenerated from `test/fixtures/notion/introspection.json` by `bun capture:notion`.

```typescript
import { createMcpConnection } from "mcp-client-gen";
import { createNotionClient } from "./notion-client";

const connection = await createMcpConnection({
  type: "http",
  url: "https://mcp.notion.com/mcp",
});
const notion = createNotionClient(connection);

const result = await notion.notionSearch({ query: "meeting notes" });
for (const block of result.content) {
  if (block.type === "text") console.log(block.text);
}

await connection.client.close();
```

Generated clients import types from `@modelcontextprotocol/client` 2.x, so projects using them need it installed.

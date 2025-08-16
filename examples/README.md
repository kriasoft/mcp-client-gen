# Examples

This directory contains generated MCP clients, templates, and usage examples demonstrating the capabilities of `mcp-client-gen`.

## Files

- `notion-capabilities.json` - Notion MCP server capabilities generated via `bun run test/manual/notion-generate.ts`
- `notion.ts` - Notion MCP client template/reference used by Codegen
- `notion-usage.ts` - Notion MCP client usage examples

## How to Generate Notion Capabilities

To regenerate the Notion capabilities file with the latest server schema:

```bash
bun run test/manual/notion-generate.ts
```

This will:

1. Authenticate with Notion via OAuth
2. Introspect the server capabilities
3. Generate `notion-capabilities.json` with all available tools, resources, and prompts
4. Create a typed client based on the introspection

## Using the Notion Client Template

The `notion.ts` file serves as a reference implementation showing:

- Proper TypeScript typing patterns
- OAuth authentication setup
- Tree-shakable exports structure
- Error handling patterns

## Usage Examples

The `notion-usage.ts` file demonstrates common patterns:

```typescript
import { createNotionClient } from "./notion";

// Initialize client with OAuth
const client = createNotionClient({
  url: "https://mcp.notion.com/mcp",
  authProvider: oauthProvider,
});

// Search workspace
const results = await client.search({
  query: "meeting notes",
  query_type: "internal",
});

// Fetch a page
const page = await client.fetch({
  id: "page-id-123",
});

// Create new pages
const newPage = await client.createPages({
  pages: [
    {
      properties: { title: "New Page" },
      content: "# Welcome\nPage content here",
    },
  ],
});
```

## Tree-Shaking Support

Import only the methods you need:

```typescript
import { search, fetch as fetchPage } from "./notion";

// Only these methods will be included in your bundle
const results = await search({ query: "test" });
const page = await fetchPage({ id: "page-id" });
```

## Dependencies

Generated clients require:

- `@modelcontextprotocol/sdk` - MCP protocol implementation
- TypeScript 5.0+ for proper type inference

## Adding More Examples

To add examples for other MCP servers:

1. Generate capabilities:

   ```bash
   npx mcp-client-gen --introspect github > github-capabilities.json
   ```

2. Create client template:

   ```typescript
   // github.ts
   export function createGithubClient(options: ClientOptions) {
     // Implementation
   }
   ```

3. Add usage examples:

   ```typescript
   // github-usage.ts
   import { createGithubClient } from "./github";
   // Examples...
   ```

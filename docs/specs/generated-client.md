# Generated Client Specification

Defines the structure and patterns for TypeScript clients generated from MCP servers.

## File Structure

Generated files follow this order:

```typescript
// 1. Header comment with timestamp
/* Generated MCP Client SDK */
/* Generated at: {ISO timestamp} */

// 2. Imports
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { McpConnection } from "mcp-client-gen";

// 3. Embedded utility functions
function handleToolResult<T>(result: any, toolName: string): T { ... }
function handleResourceResult<T>(result: any, resourceUri: string): T { ... }

// 4. Input interfaces for each tool
export interface {ToolName}Input { ... }

// 5. Client class per server
export class {Server}Client { ... }

// 6. Factory function per server
export function create{Server}Client(connection: McpConnection): {Server}Client { ... }
```

## Type Generation Rules

JSON Schema to TypeScript mapping:

| JSON Schema                      | TypeScript            |
| -------------------------------- | --------------------- |
| `type: "string"`                 | `string`              |
| `type: "string", enum: [...]`    | `"a" \| "b" \| "c"`   |
| `type: "number"` or `"integer"`  | `number`              |
| `type: "boolean"`                | `boolean`             |
| `type: "null"`                   | `null`                |
| `type: "array", items: T`        | `T[]`                 |
| `type: "object", properties: {}` | `{ prop: T; ... }`    |
| `type: "object"` (no properties) | `Record<string, any>` |
| `anyOf: [...]` or `oneOf: [...]` | `A \| B \| C`         |
| `allOf: [...]`                   | `A & B & C`           |
| Array of types `[T1, T2]`        | `T1 \| T2`            |

Property optionality: Properties not in `required` array get `?` modifier.

## Naming Conventions

| Element          | Convention                       | Example                  |
| ---------------- | -------------------------------- | ------------------------ |
| Client class     | PascalCase + "Client"            | `NotionClient`           |
| Factory function | "create" + PascalCase + "Client" | `createNotionClient()`   |
| Tool method      | camelCase                        | `notionCreatePages()`    |
| Input interface  | PascalCase + "Input"             | `NotionCreatePagesInput` |

### Server Name Derivation

Client class names derive from server name via `extractServerName()`:

1. **Explicit name** — `McpServerConfig.name` if provided (from config key)
2. **URL hostname** — second-to-last segment (e.g., `api.notion.com` → `notion`)
3. **URL path** — first path segment if hostname fails (excluding `mcp`, `v1`)
4. **Fallback** — `server{N}` where N is 1-indexed position

Examples:

- `{ name: "acme" }` → `AcmeClient`
- `https://api.notion.com/mcp` → `NotionClient`
- `https://mcp.example.com/github/v1` → `GithubClient`
- `https://localhost:3000` → `Server1Client`

Tool name to method name conversion:

- `search` -> `search()`
- `notion-create-pages` -> `notionCreatePages()`
- `fetch` -> `fetch()`

## Client Class Pattern

```typescript
export class {Server}Client {
  private connection: McpConnection;

  constructor(connection: McpConnection) {
    this.connection = connection;
  }

  /** Tool description from MCP server */
  async {toolMethod}(input: {ToolName}Input): Promise<any> {
    const result = await this.connection.client.callTool({
      name: "{original-tool-name}",
      arguments: input,
    });
    return handleToolResult(result, "{original-tool-name}");
  }

  // Resources: typed with MCP SDK content types
  async getResource(uri: string): Promise<TextResourceContents | BlobResourceContents> { ... }
  async get{ResourceName}(): Promise<TextResourceContents | BlobResourceContents> { ... }

  // Prompts: typed with MCP SDK message type
  async {promptName}Prompt(args: { ... }): Promise<PromptMessage[]> { ... }
}
```

## Return Types

| Method Type | Return Type                                             | Notes                                           |
| ----------- | ------------------------------------------------------- | ----------------------------------------------- |
| Tools       | `Promise<{ToolName}Output>` or `Promise<any>`           | Uses output type when `outputSchema` is present |
| Resources   | `Promise<TextResourceContents \| BlobResourceContents>` | MCP SDK types for resource content              |
| Prompts     | `Promise<PromptMessage[]>`                              | Array of MCP SDK prompt messages                |

Tools return typed output when the server provides `outputSchema`, otherwise `any`. The `handleToolResult` helper has a generic parameter for manual casting when needed.

## Factory Function

Simple factory for convenience; user manages instance lifecycle.

```typescript
export function createNotionClient(connection: McpConnection): NotionClient {
  return new NotionClient(connection);
}
```

## Embedded Helpers

Helpers are embedded directly in generated code to avoid runtime dependencies:

### handleToolResult

```typescript
function handleToolResult<T = any>(result: any, toolName: string): T {
  if (result.isError) {
    const errorContent = result.content?.[0];
    const errorMessage =
      errorContent && typeof errorContent === "object" && "text" in errorContent
        ? String(errorContent.text)
        : "Tool execution failed";
    throw new Error(`Tool '${toolName}' error: ${errorMessage}`);
  }

  if (
    !result.content ||
    !Array.isArray(result.content) ||
    result.content.length === 0
  ) {
    throw new Error(`Tool '${toolName}' returned empty content`);
  }

  const content = result.content[0];
  if (!content || typeof content !== "object") {
    throw new Error(`Tool '${toolName}' returned invalid content structure`);
  }

  return content as T;
}
```

### handleResourceResult

```typescript
function handleResourceResult<T = any>(result: any, resourceUri: string): T {
  if (
    !result.contents ||
    !Array.isArray(result.contents) ||
    result.contents.length === 0
  ) {
    throw new Error(`Resource '${resourceUri}' returned empty contents`);
  }
  return result.contents[0] as T;
}
```

## JSDoc Preservation

Tool/resource descriptions from MCP server become JSDoc comments:

```typescript
/**
 * Perform a search over:
 * - "internal": Perform a semantic search over your entire Notion workspace...
 * - "users": Perform a search over the Notion users...
 */
async search(input: SearchInput): Promise<any> { ... }
```

Property descriptions become inline JSDoc:

```typescript
export interface SearchInput {
  /** Semantic search query over your entire Notion workspace */
  query: string;
  /** Specify type of the query as either "internal" or "user" */
  query_type?: "internal" | "user";
}
```

## Usage Example

Input: MCP server with tool `search` having inputSchema:

```json
{
  "type": "object",
  "properties": {
    "query": { "type": "string", "description": "Search query" },
    "query_type": { "type": "string", "enum": ["internal", "user"] }
  },
  "required": ["query"]
}
```

Output:

```typescript
export interface SearchInput {
  /** Search query */
  query: string;
  query_type?: "internal" | "user";
}

export class NotionClient {
  private connection: McpConnection;

  constructor(connection: McpConnection) {
    this.connection = connection;
  }

  async search(input: SearchInput): Promise<any> {
    const result = await this.connection.client.callTool({
      name: "search",
      arguments: input,
    });
    return handleToolResult(result, "search");
  }
}

export function createNotionClient(connection: McpConnection): NotionClient {
  return new NotionClient(connection);
}
```

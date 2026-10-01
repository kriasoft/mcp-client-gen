# MCP Introspection Specification

Defines how MCP server capabilities are discovered for code generation.

## Introspection Data

Data fetched from each MCP server:

| Field               | Type                     | Source                                                                                                 |
| ------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------ |
| `capabilities`      | `ServerCapabilities`     | Handshake response                                                                                     |
| `tools`             | `Tool[]`                 | `listTools()` if `capabilities.tools` set                                                              |
| `resources`         | `Resource[]`             | `listResources()` if `capabilities.resources` set                                                      |
| `resourceTemplates` | `ResourceTemplateType[]` | `listResourceTemplates()` if `capabilities.resources` set; `[]` if the server answers method-not-found |
| `prompts`           | `Prompt[]`               | `listPrompts()` if `capabilities.prompts` set                                                          |

## Connection Flow

```
introspectServer(server, config)               // src/introspection.ts
  └─ createMcpConnection(server, config)       // src/mcp-client.ts
      ├─ Create transport (http or sse), OAuth provider for https: / loopback http:
      ├─ client.connect(transport)             // handshake: capabilities exchange
      ├─ capabilities = client.getServerCapabilities()
      ├─ tools / resources / templates / prompts = list*() // if advertised; sequential
      └─ authorized = provider holds tokens
  └─ client.close(); return the snapshot
```

## Introspection Type

```typescript
interface Introspection {
  capabilities: ServerCapabilities; // {} if none advertised
  tools: Tool[];
  resources: Resource[];
  resourceTemplates: ResourceTemplateType[];
  prompts: Prompt[];
  authorized: boolean; // requests carried OAuth tokens (the CLI then shows OAuth usage)
}
```

## Error Handling

`introspectServer()` throws, and errors pass through unchanged so SDK error types (`UnauthorizedError`, `SdkHttpError`, …) and causes stay inspectable. Callers add context: the CLI labels each failure with the server name (never its config URL, which may hold expanded secrets) and, in config mode, writes nothing if any server failed (ADR-001).

## Transport Types

| Type    | Class                           | Use Case                    |
| ------- | ------------------------------- | --------------------------- |
| `http`  | `StreamableHTTPClientTransport` | Modern streaming HTTP       |
| `sse`   | `SSEClientTransport`            | Server-sent events fallback |
| `stdio` | Not supported                   | Requires process spawning   |

## Tool Schema Structure

From MCP SDK types:

```typescript
interface Tool {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, JSONSchema>;
    required?: string[];
    additionalProperties?: boolean | JSONSchema;
  };
}
```

## Resource Structure

```typescript
interface Resource {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}
```

## Prompt Structure

```typescript
interface Prompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}
```

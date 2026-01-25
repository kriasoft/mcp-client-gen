# MCP Introspection Specification

Defines how MCP server capabilities are discovered for code generation.

## Introspection Data

Data fetched from each MCP server:

| Field          | Type                 | Source                                            |
| -------------- | -------------------- | ------------------------------------------------- |
| `capabilities` | `ServerCapabilities` | Handshake response                                |
| `tools`        | `Tool[]`             | `listTools()` if `capabilities.tools` set         |
| `resources`    | `Resource[]`         | `listResources()` if `capabilities.resources` set |
| `prompts`      | `Prompt[]`           | `listPrompts()` if `capabilities.prompts` set     |

## Connection Flow

```
createMcpConnection(server, config)
  │
  ├─ Create transport (http or sse)
  │   └─ Attach OAuth provider if auth required
  │
  ├─ client.connect(transport)
  │   └─ Handshake: client ↔ server capabilities exchange
  │
  ├─ capabilities = client.getServerCapabilities()
  │
  ├─ if (capabilities.tools)
  │   └─ tools = await client.listTools()
  │
  ├─ if (capabilities.resources)
  │   └─ resources = await client.listResources()
  │
  ├─ if (capabilities.prompts)
  │   └─ prompts = await client.listPrompts()
  │
  └─ return { client, server, capabilities, tools, resources, prompts }
```

## IntrospectionResult Types

Discriminated union: check `ok` to narrow the type.

```typescript
interface IntrospectionSuccess {
  ok: true;
  server: McpServerConfig;
  capabilities?: ServerCapabilities;
  tools: Tool[];
  resources: Resource[];
  prompts: Prompt[];
}

interface IntrospectionFailure {
  ok: false;
  server: McpServerConfig;
  error: string;
}

type IntrospectionResult = IntrospectionSuccess | IntrospectionFailure;
```

## Parallel Introspection

Multiple servers introspected concurrently via `introspectServers()`:

```typescript
const results = await introspectServers(servers, config);
// Results preserve input order
// Each result either has data or error (not both)
```

## Error Handling

Graceful degradation per server:

```typescript
// In generateClient():
const successes = new Map<string, IntrospectionSuccess>();
const failures = new Map<string, IntrospectionFailure>();

for (const result of results) {
  const name = extractServerName(result.server, i);
  if (!result.ok) {
    failures.set(name, result);
  } else {
    successes.set(name, result);
  }
}

// Continue if any server succeeded
if (successes.size > 0) {
  generateClientFile(successes, options);
}

// Report failures to user
for (const [name, failure] of failures) {
  console.warn(`Warning: ${name} (${failure.server.url}): ${failure.error}`);
}
```

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

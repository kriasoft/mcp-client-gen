# Introspection Specification

How a server's capabilities are captured for code generation. Code: `src/introspection.ts`, `src/mcp-client.ts`. OAuth: ADR-002.

Introspection is generation-time only and internal; generated clients never introspect.

## Snapshot

```typescript
interface Introspection {
  capabilities: ServerCapabilities; // {} if none advertised
  tools: Tool[];
  resources: Resource[];
  resourceTemplates: ResourceTemplateType[];
  prompts: Prompt[];
  authorized: boolean; // requests carried OAuth tokens: the CLI then shows OAuth usage
}
```

Types are the SDK's (`@modelcontextprotocol/client`). Over Streamable HTTP they come from the newest protocol era both sides speak, not the SDK's legacy default.

Static `server.headers` are the MCP server's credentials: they go only to requests for its origin, never to OAuth discovery or token endpoints, which share the transport's fetch (the SDK's `requestInit` would apply to those too, so it isn't used).

| Field               | Source                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `capabilities`      | initialize handshake                                                                       |
| `tools`             | `listTools()` if `capabilities.tools`                                                      |
| `resources`         | `listResources()` if `capabilities.resources`                                              |
| `resourceTemplates` | `listResourceTemplates()` if `capabilities.resources`; `[]` on a JSON-RPC method-not-found |
| `prompts`           | `listPrompts()` if `capabilities.prompts`                                                  |

List calls without a cursor return every page.

## Flow

```
introspectServer(server, config)                 // src/introspection.ts
  └─ createMcpConnection(server, config)         // src/mcp-client.ts
      ├─ OAuth provider (browserAuth) for https: or loopback http: URLs only
      ├─ connect: http → auth.connect(client) or a plain StreamableHTTPClientTransport,
      │           negotiating the protocol era (2026-07-28 when the server speaks it)
      │           sse  → SSEClientTransport; on 401, completeAuthorization() + fresh transport
      ├─ list tools → resources → templates → prompts, sequentially
      │     each UnauthorizedError (step-up) → complete the browser flow, retry (≤ 3 times)
      └─ authorized = the provider holds tokens
  └─ client.close(); return the snapshot
```

- **Sequential listing:** OAuth refreshes on a caller-owned SSE transport must not overlap.
- **Step-up:** completing every flow a listing triggers means no callback listener outlives introspection. Exception: if `signal` aborts while a listing's step-up is pending, that flow's listener stays until the OAuth timeout (ADR-002 Impact), so the redirect port isn't free at once.
- **Cleanup:** a listing failure closes the client before rethrowing.

## Transports

| `type`           | Class                           | Notes                                                                                                                                  |
| ---------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `http` (default) | `StreamableHTTPClientTransport` | `versionNegotiation: { mode: "auto" }`; `server.headers` only on requests to the server's origin                                       |
| `sse`            | `SSEClientTransport`            | Deprecated in MCP; legacy era. `server.headers` (under request headers) only to the server's origin; each request bounded by `timeout` |
| `stdio`          | not supported                   | Config entries with `command` are skipped (SPEC-config)                                                                                |

## Options

`GenerateClientOptions` (= internal `McpClientConfig`):

| Option    | Effect                                                                                                                                 |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `oauth`   | `browserAuth()` options without `serverUrl` (ADR-002); `false` never opens a browser, so a server demanding OAuth fails                |
| `fetch`   | custom fetch for every request (proxies, interceptors, tests)                                                                          |
| `timeout` | per request while connecting and listing (SDK default 60 s)                                                                            |
| `signal`  | aborts connecting, listing and a pending browser flow (except a step-up begun by listing, see Flow); every transport request honors it |

## Errors

`introspectServer()` throws, and errors pass through unchanged so SDK error types (`UnauthorizedError`, `SdkHttpError`, …) and causes stay inspectable.

Callers add context:

- **CLI:** labels each failure with the server name, never its config URL.
- **Config mode:** writes nothing if any server failed (ADR-001).

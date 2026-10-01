# Introspection Specification

How a server's capabilities are captured for code generation. Code: `src/introspection.ts`, `src/connect.ts`. OAuth: ADR-002.

Introspection is generation-time only and internal; generated clients never introspect.

## Snapshot

```typescript
interface ServerSnapshot {
  protocolVersion: string; // negotiated revision, e.g. "2026-07-28"
  protocolEra: ProtocolEra; // "modern" | "legacy": structured output shapes differ (ADR-003)
  capabilities: ServerCapabilities; // {} if none advertised
  tools: Tool[];
  resources: Resource[];
  resourceTemplates: ResourceTemplateType[];
  prompts: Prompt[];
  authorized: boolean; // requests carried OAuth tokens: the CLI then shows OAuth usage
}
```

Types are the SDK's (`@modelcontextprotocol/client`). Over Streamable HTTP they come from the newest protocol era both sides speak, not the SDK's legacy default.

Static endpoint `headers` are the MCP server's credentials: they go only to requests for its origin, never to OAuth discovery or token endpoints, which share the transport's fetch (the SDK's `requestInit` would apply to those too, so it isn't used). Requests carrying them don't follow redirects, which would forward custom headers to the redirect's origin: a redirect fails with `MCP server redirected (HTTP 3xx)`, and the fix is configuring the final URL.

Before any request, `connectMcp` rejects a URL that isn't `http:`/`https:` (`TypeError`) and a `timeout` that isn't a positive number of milliseconds up to 2³¹−1 (`RangeError`), so both transports fail alike.

| Field               | Source                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `protocolVersion`   | `client.getNegotiatedProtocolVersion()`                                                    |
| `protocolEra`       | `client.getProtocolEra()`                                                                  |
| `capabilities`      | initialize handshake                                                                       |
| `tools`             | `listTools()` if `capabilities.tools`                                                      |
| `resources`         | `listResources()` if `capabilities.resources`                                              |
| `resourceTemplates` | `listResourceTemplates()` if `capabilities.resources`; `[]` on a JSON-RPC method-not-found |
| `prompts`           | `listPrompts()` if `capabilities.prompts`                                                  |

List calls without a cursor return every page (the SDK follows `nextCursor`; a test pins it).

## Flow

```
introspectServer(endpoint, options)              // src/introspection.ts
  ├─ connectMcp(endpoint, options)               // src/connect.ts
  │   ├─ OAuth provider (browserAuth) for https: or loopback http: URLs only
  │   └─ connect: http → auth.connect(client) or a plain StreamableHTTPClientTransport,
  │               negotiating the protocol era (2026-07-28 when the server speaks it)
  │               sse  → SSEClientTransport; on 401, completeAuthorization() + fresh transport
  ├─ list tools → resources → templates → prompts, sequentially
  │     each UnauthorizedError (step-up) → complete the browser flow, retry (≤ 3 flows per introspection)
  ├─ authorized = the provider holds tokens
  └─ finally client.close(); return the snapshot
```

`connect.ts` owns transports and OAuth; `introspection.ts` owns listing, step-up retries and closing.

- **Sequential listing:** OAuth refreshes on a caller-owned SSE transport must not overlap.
- **Step-up:** each flow a listing triggers is completed (or ended by `signal`) and the listing retried; the budget is three flows across all listings, and the third fails its listing. Over Streamable HTTP closing the client ends a flow still pending (that third one, or one an abort interrupted); over SSE the third is drained. So no callback listener outlives introspection. Exception (legacy SSE): if `signal` aborts while a request's authorization is still being set up, its listener stays until the OAuth timeout (ADR-002 Impact).
- **Cleanup:** a connection failure closes the client in `connectMcp`; introspection always attempts to close it after listing. When listing failed, that error wins; otherwise a close failure surfaces instead of hiding.

## Transports

| `transport`      | Class                           | Notes                                                                                                                           |
| ---------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `http` (default) | `StreamableHTTPClientTransport` | `versionNegotiation: { mode: "auto" }`; `headers` only on requests to the server's origin                                       |
| `sse`            | `SSEClientTransport`            | Deprecated in MCP; legacy era. `headers` (under request headers) only to the server's origin; each request bounded by `timeout` |
| `stdio`          | not supported                   | Config entries with `command` are skipped (SPEC-config)                                                                         |

## Options

`ConnectOptions` (`src/connect.ts`): `oauth`, `fetch`, `timeout` and `signal`, the connection fields of the public `GenerateClientOptions` (SPEC-api, which specifies them).

## Errors

`introspectServer()` throws, and errors pass through unchanged so SDK error types (`UnauthorizedError`, `SdkHttpError`, …) and causes stay inspectable.

Callers add context:

- **CLI:** labels each failure with the server name, never its config URL.
- **Config mode:** writes nothing if any server failed (ADR-001).

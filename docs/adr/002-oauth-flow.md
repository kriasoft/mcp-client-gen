# ADR-002 OAuth Flow Delegation

**Status:** Accepted  
**Date:** 2025-01-25 (revised 2026-09-30 for MCP SDK v2 / oauth-callback v3; 2026-10-01: generation-time only)  
**Tags:** oauth, security, authentication

## Problem

- MCP servers with HTTP/SSE transport may require OAuth 2.1 (DCR, PKCE, resource indicators, step-up).
- Generating a client means introspecting the server, so the generator needs a browser-based flow with a loopback redirect, without owning OAuth protocol logic. Apps connecting generated clients bring their own auth (ADR-003).

## Decision

- The MCP SDK (`@modelcontextprotocol/client` 2.x) owns OAuth: discovery, registration, PKCE, token exchange and refresh.
- `oauth-callback/mcp`'s `browserAuth()` supplies the `OAuthClientProvider`: browser launch, loopback listener, state checks and credential persistence.
- OAuth applies only to `https:` or loopback `http:` servers, where bearer tokens can't leak (oauth-callback rejects others). Other `http:` servers, e.g. on a private network, connect unauthenticated; `server.headers` still apply.
- The internal `createMcpConnection()` builds the provider from `GenerateClientOptions.oauth`:
  - `serverUrl` comes from the server; `redirectUri` defaults to `http://127.0.0.1:3000/callback`. The port is fixed because DCR registers the exact URI.
  - `clientName` defaults to `mcp-client-gen` unless a pre-registered `clientInformation` is given (the two are exclusive).
  - `store` is a `CredentialStore`, bound to the one server being generated. Default: memory.
- Streamable HTTP connects via `auth.connect(client)`, which also handles step-up re-authorization. SSE (deprecated in MCP) connects on its own transport; on `UnauthorizedError` it calls `auth.completeAuthorization(transport)` and reconnects on a fresh transport. That transport's fetch bounds the wait for response headers (the provider can't interrupt its token exchange), and listings run sequentially so OAuth refreshes on it never overlap.
- An authorization demanded after connecting (`UnauthorizedError`: a 403 `insufficient_scope` step-up over Streamable HTTP, or a 401 over SSE, whose transport doesn't turn 403s into authorizations) is completed on the live connection: `auth.connect(client)` for Streamable HTTP, `auth.completeAuthorization(transport)` for SSE. oauth-callback can't cancel a pending flow short of signing out, so capability listing completes every one it triggers (up to three), and no browser flow outlives the connection.
- Generated clients take the SDK `Client` and import SDK types only (ADR-003); auth stays with whoever connected that client, typically `browserAuth().connect(client)`, which also completes step-ups at runtime.

```typescript
const code = await generateClient("https://mcp.notion.com/mcp", {
  oauth: { store: fileStore("/abs/path/notion-credentials.json") },
});
```

## Alternatives (brief)

- **Embedded OAuth implementation** — rejected; duplicates the SDK's flow logic.
- **Ephemeral redirect port** — rejected; DCR records the redirect URI, so the port must be stable.

## Impact

- Positive: No OAuth protocol code here; token refresh and step-up come from the SDK.
- Negative/Risks: A flow abandoned mid-way keeps its callback listener until the OAuth timeout; ending it early needs an oauth-callback API that cancels a flow without signing out. Config mode introspects servers one at a time so their flows don't contend for the loopback port (ADR-001). Requires Node.js 22+ (oauth-callback v3). v2 token files are not migrated; users authorize once after upgrading.

## Links

- Code: `src/mcp-client.ts`
- Related: [oauth-callback](https://github.com/kriasoft/oauth-callback) (its ADR-006: MCP SDK owns OAuth)
- Specs: [RFC 7591](https://datatracker.ietf.org/doc/html/rfc7591), [RFC 7636](https://datatracker.ietf.org/doc/html/rfc7636), [RFC 8252](https://datatracker.ietf.org/doc/html/rfc8252)

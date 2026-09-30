# ADR-002 OAuth Flow Delegation

**Status:** Accepted  
**Date:** 2025-01-25 (revised 2026-09-30 for MCP SDK v2 / oauth-callback v3)  
**Tags:** oauth, security, authentication

## Problem

- MCP servers with HTTP/SSE transport may require OAuth 2.1 (DCR, PKCE, resource indicators, step-up).
- A CLI needs a browser-based flow with a loopback redirect, without owning OAuth protocol logic.

## Decision

- The MCP SDK (`@modelcontextprotocol/client` 2.x) owns OAuth: discovery, registration, PKCE, token exchange and refresh.
- `oauth-callback/mcp`'s `browserAuth()` supplies the `OAuthClientProvider`: browser launch, loopback listener, state checks and credential persistence.
- OAuth applies only to `https:` or loopback `http:` servers, where bearer tokens can't leak (oauth-callback rejects others). Other `http:` servers, e.g. on a private network, connect unauthenticated; `server.headers` still apply.
- `createMcpConnection()` builds one provider per server from `McpClientConfig.oauth`:
  - `serverUrl` comes from the server config; `redirectUri` defaults to `http://127.0.0.1:3000/callback`. The port is fixed because DCR registers the exact URI.
  - `clientName` defaults to the client name unless a pre-registered `clientInformation` is given (the two are exclusive).
  - `store` is a factory `(server) => CredentialStore`: a store is bound to one server, and one config is shared by every server in `generateClient()`. Default: memory.
- Streamable HTTP connects via `auth.connect(client)`, which also handles step-up re-authorization. SSE (deprecated in MCP) connects on its own transport; on `UnauthorizedError` it calls `auth.completeAuthorization(transport)` and reconnects on a fresh transport. That transport's fetch bounds the wait for response headers (the provider can't interrupt its token exchange), and listings run sequentially so OAuth refreshes on it never overlap.
- Generated clients import SDK types only (`import type`), so they carry no runtime SDK dependency.

```typescript
const connection = await createMcpConnection(server, {
  oauth: {
    store: (s) => fileStore(`/abs/path/${encodeURIComponent(s.url)}.json`),
  },
});
```

## Alternatives (brief)

- **Embedded OAuth implementation** — rejected; duplicates the SDK's flow logic.
- **Single shared store** — rejected; oauth-callback rejects credentials that belong to another server.
- **Ephemeral redirect port** — rejected; DCR records the redirect URI, so the port must be stable.

## Impact

- Positive: No OAuth protocol code here; token refresh and step-up come from the SDK.
- Negative/Risks: Concurrent authorizations for several servers contend for the same loopback port. Requires Node.js 22+ (oauth-callback v3). v2 token files are not migrated; users authorize once after upgrading.

## Links

- Code: `src/mcp-client.ts`
- Related: [oauth-callback](https://github.com/kriasoft/oauth-callback) (its ADR-006: MCP SDK owns OAuth)
- Specs: [RFC 7591](https://datatracker.ietf.org/doc/html/rfc7591), [RFC 7636](https://datatracker.ietf.org/doc/html/rfc7636), [RFC 8252](https://datatracker.ietf.org/doc/html/rfc8252)

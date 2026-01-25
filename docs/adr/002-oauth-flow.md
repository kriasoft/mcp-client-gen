# ADR-002 OAuth Flow Delegation

**Status:** Accepted
**Date:** 2025-01-25
**Tags:** oauth, security, authentication

## Problem

- MCP servers with HTTP/SSE transport require OAuth 2.1 authentication
- CLI tools need a secure browser-based flow for user consent
- Must handle RFC 7591 dynamic client registration, PKCE, and token persistence

## Decision

- Delegate OAuth implementation to `oauth-callback` library
- Use `browserAuth()` factory to create MCP SDK-compatible `OAuthClientProvider`
- Support pluggable token storage (in-memory default, file-based for persistence)

```typescript
import { browserAuth, inMemoryStore } from "oauth-callback/mcp";

const authProvider = browserAuth({
  port: 3000,
  hostname: "localhost",
  callbackPath: "/callback",
  store: inMemoryStore(),
  launch: open, // from "open" package
});
```

## Key Design Points

### Browser Flow Integration

The `browserAuth()` provider handles the complete flow:

1. Launches browser to authorization URL
2. Spins up local callback server on configured port
3. Captures authorization code from redirect
4. Validates CSRF state parameter
5. Exchanges code for tokens immediately
6. Persists tokens to configured store

### Dynamic Client Registration (RFC 7591)

When no `clientId` is provided, the library uses DCR:

- Registers client with MCP server's authorization server
- Stores registration for session reuse (via `OAuthStore`)
- Static `clientId` takes precedence over DCR-obtained client

### PKCE (RFC 7636)

Always enabled via MCP SDK contract:

- `saveCodeVerifier()` called before authorization
- `codeVerifier()` retrieved during token exchange
- `OAuthStore` can persist verifier for crash recovery

### Token Storage Strategy

Two interfaces supported:

```typescript
// Minimal: tokens only
interface TokenStore {
  get(key: string): Promise<Tokens | null>;
  set(key: string, tokens: Tokens): Promise<void>;
  delete(key: string): Promise<void>;
}

// Extended: + client info + code verifier
interface OAuthStore extends TokenStore {
  getClient(key: string): Promise<ClientInfo | null>;
  setClient(key: string, client: ClientInfo): Promise<void>;
  deleteClient(key: string): Promise<void>;

  getCodeVerifier(key: string): Promise<string | null>;
  setCodeVerifier(key: string, verifier: string): Promise<void>;
  deleteCodeVerifier(key: string): Promise<void>;
}
```

Built-in implementations: `inMemoryStore()`, `fileStore(path)`

### Token Expiry Handling

- Absolute expiry time computed from `expires_in` response
- 60-second buffer before returning undefined from `tokens()`
- MCP SDK triggers re-authentication when tokens() returns undefined

## Alternatives (brief)

- **Embedded OAuth implementation** — rejected; duplicates well-tested flow logic, increases maintenance
- **Manual token flow** — rejected; requires user to copy-paste codes, poor UX
- **Electron/native webview** — rejected; heavyweight for CLI tool, dependency burden

## Impact

- Positive: Proven OAuth implementation, extensible storage, crash recovery support
- Positive: Clean separation between MCP client code and authentication concerns
- Negative/Risks: External dependency adds version coordination; library updates may require adaptation

## Links

- Code: `src/mcp-client.ts`, `oauth-callback` library
- Related: [oauth-callback docs](https://github.com/kriasoft/oauth-callback)
- Specs: [RFC 7591](https://datatracker.ietf.org/doc/html/rfc7591), [RFC 7636](https://datatracker.ietf.org/doc/html/rfc7636)

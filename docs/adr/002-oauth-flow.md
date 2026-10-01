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
- OAuth applies only to `https:` or loopback `http:` servers (`localhost`, `*.localhost`, `127.0.0.1`, `[::1]`, as in the SDK), where bearer tokens can't leak (oauth-callback rejects others). Other `http:` servers, e.g. on a private network, connect unauthenticated; endpoint `headers` still apply. `oauth: false` disables the provider everywhere (e.g. CI, where no browser can open), so a server demanding OAuth fails instead of waiting for approval.
- Endpoint `headers` go only to the MCP server's origin, through an origin-scoped fetch wrapper, not to the authorization server, which the SDK reaches through the same transport fetch.
- The internal `connectMcp()` builds the provider from `GenerateClientOptions.oauth`:
  - `serverUrl` comes from the server; `redirectUri` defaults to `http://127.0.0.1:3000/callback`. The port is fixed because DCR registers the exact URI.
  - `clientName` defaults to `mcp-client-gen` unless a pre-registered `clientInformation` is given (the two are exclusive).
  - `store` is a `CredentialStore`, bound to the one server being generated. Default: memory.
- Streamable HTTP connects via `auth.connect(client)`, which also handles step-up re-authorization. SSE (deprecated in MCP) connects on its own transport; on `UnauthorizedError` it calls `auth.completeAuthorization(transport)` and reconnects on a fresh transport. That transport's fetch bounds the wait for response headers (the provider can't interrupt its token exchange), and listings run sequentially so OAuth refreshes on it never overlap.
- `GenerateClientOptions.signal` aborts connecting (including a pending browser flow, which `connect()` / `completeAuthorization()` end) and listing. Every transport request honors it, since the SDK doesn't pass its signal to all handshake traffic.
- An authorization demanded after connecting (`UnauthorizedError`: a 403 `insufficient_scope` step-up over Streamable HTTP, or a 401 over SSE, whose transport doesn't turn 403s into authorizations) is completed on the live connection: `auth.connect(client)` for Streamable HTTP, `auth.completeAuthorization(transport)` for SSE. Capability listing completes each flow it triggers and retries, up to three flows per introspection (across listings: each is a browser prompt). A flow pending on a `connect()` connection also ends when that connection closes (oauth-callback 3.1), so an abort mid-step-up frees the redirect port at once, and the third flow, which can't rescue the listing, is left to the close. One on an SSE transport ends only by completing (an aborted signal still ends the wait), so the third is drained.
- Generated clients take the SDK `Client` and import SDK types only (ADR-003); auth stays with whoever connected that client, typically `browserAuth().connect(client)`, which also completes step-ups at runtime.

```typescript
const code = await generateClientModule("https://mcp.notion.com/mcp", {
  oauth: { store: fileStore("/abs/path/notion-credentials.json") },
});
```

## Alternatives (brief)

- **Embedded OAuth implementation** — rejected; duplicates the SDK's flow logic.
- **Ephemeral redirect port** — rejected for now; DCR records the redirect URI, and RFC 8252's "any loopback port" rule isn't honored by every authorization server, so oauth-callback requires a fixed port. `oauth.redirectUri` picks another one, and the CLI's `--oauth-port` (port 3000 is a common dev-server port).
- **A hosted CIMD identity for mcp-client-gen** — deferred. MCP 2026-07-28 prefers Client ID Metadata Documents over DCR, but a CIMD client needs a hosted HTTPS metadata document. Callers with their own pass `oauth.clientMetadataUrl` (oauth-callback 3.1); generation falls back to DCR otherwise.
- **Refusing static endpoint `headers` on plain `http:`** — rejected; OAuth is limited to secure origins because the tokens are obtained automatically, while configured headers are the user's explicit choice (as in other MCP clients).

## Impact

- Positive: No OAuth protocol code here; token refresh and step-up come from the SDK.
- Negative/Risks: Generation completes every browser flow it starts or ends it via `options.signal` or by closing the connection, releasing its callback listener; except over legacy SSE, where an abort that lands while a request's authorization is still being set up leaves that flow's listener until the OAuth timeout: closing a caller-created transport doesn't end its flow in oauth-callback, and its only other cancel (`invalidateCredentials("all")`) would clear a user's store. Config mode introspects servers one at a time so their flows don't contend for the loopback port (ADR-001). Requires Node.js 22+ (oauth-callback 3.1+). v2 token files are not migrated; users authorize once after upgrading.

## Links

- Code/Docs: `src/connect.ts`, SPEC-introspection
- Related ADRs: ADR-001, ADR-003
- Related: [oauth-callback](https://github.com/kriasoft/oauth-callback) (its ADR-006: MCP SDK owns OAuth)
- Specs: [RFC 7591](https://datatracker.ietf.org/doc/html/rfc7591), [RFC 7636](https://datatracker.ietf.org/doc/html/rfc7636), [RFC 8252](https://datatracker.ietf.org/doc/html/rfc8252)

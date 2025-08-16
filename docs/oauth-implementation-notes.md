# OAuth Implementation Notes

## Critical Discoveries from OAuth Flow Debugging

This document captures non-obvious findings and gotchas discovered while implementing OAuth support for MCP servers. These issues took significant debugging to understand and resolve.

## 1. Client Info Persistence Problem

### Issue

The MCP SDK's `auth()` function has error recovery logic that calls `invalidateCredentials('all')` when it receives `InvalidClientError` or `UnauthorizedClientError` during token exchange. This clears ALL stored OAuth data including the dynamically registered client information, causing subsequent retries to fail with "Existing OAuth client information is required when exchanging an authorization code".

### Root Cause

- SDK's auth.js lines 137-143: Catches specific errors and invalidates all credentials
- This happens DURING the token exchange, not before
- The retry then fails because client info is gone

### Solution

Track when we're exchanging an authorization code (`isExchangingCode` flag) and override `invalidateCredentials()` to preserve client info and code verifier during this critical phase.

## 2. Transport Reuse Limitation

### Issue

After calling `transport.finishAuth(code)`, attempting to use the same transport for `client.connect()` throws:

```
StreamableHTTPClientTransport already started! If using Client class, note that connect() calls start() automatically.
```

### Solution

You MUST create new `StreamableHTTPClientTransport` and `Client` instances after token exchange. The original transport cannot be reused.

## 3. Callback Server Lifecycle

### Issue

Initial attempts tried to keep the callback server running or manage its lifecycle manually, leading to "site can't be reached" errors.

### Understanding

The `oauth-callback` package correctly handles the entire lifecycle:

1. Starts server on specified port
2. Opens browser to authorization URL
3. Waits for OAuth provider redirect
4. Captures authorization code
5. Automatically shuts down server
6. Returns control with the code

This is the expected behavior - don't try to keep it running longer.

## 4. Client Authentication Method

### Issue

Implementing `addClientAuthentication()` method (even as empty) causes "Client ID is required" errors during token exchange.

### Root Cause

SDK's auth.js line 595: `if (addClientAuthentication)` - checks for truthiness
If the method exists, SDK skips its default authentication logic (lines 599-603)

### Solution

DO NOT implement `addClientAuthentication()`. Let it remain undefined so the SDK uses its default logic based on the server's `token_endpoint_auth_methods_supported`.

## 5. OAuth Flow Sequence

The correct sequence for OAuth with MCP SDK:

```typescript
// 1. First connection attempt - triggers OAuth
try {
  await client.connect(transport);
} catch (error) {
  // 2. Expected UnauthorizedError - OAuth was triggered
  if (error.constructor.name === "UnauthorizedError") {
    // 3. Get the authorization code (single-use!)
    const pendingAuth = authProvider.getPendingAuthCode();

    // 4. Exchange code for tokens
    await transport.finishAuth(pendingAuth.code);

    // 5. Create NEW transport and client
    const newTransport = new StreamableHTTPClientTransport(url, {
      authProvider,
    });
    const newClient = new Client(info, capabilities);

    // 6. Connect with authentication
    await newClient.connect(newTransport);
  }
}
```

## 6. Single-Use Authorization Code

The `getPendingAuthCode()` method is intentionally single-use:

- Returns the code once
- Sets `isExchangingCode = true` to protect client info
- Clears the code from memory (security)

This prevents replay attacks and ensures the protection flag is set at the right time.

## Key Files

- `src/oauth-provider.ts` - Main OAuth provider with workarounds
- `src/oauth-storage.ts` - Storage interface and implementations
- `test/manual/notion-generate.ts` - Working example with OAuth that generates Notion client
- `test/e2e/notion.spec.ts` - E2E test with OAuth flow

## Testing OAuth

```bash
# Generate Notion client with OAuth (requires browser authorization)
bun run test/manual/notion-generate.ts

# Run E2E tests with OAuth
bun test:e2e

# Test OAuth provider with mock server (no browser needed)
bun test src/oauth-provider.test.ts
```

## Common Errors and Solutions

| Error                                            | Cause                                       | Solution                                                |
| ------------------------------------------------ | ------------------------------------------- | ------------------------------------------------------- |
| "Client ID is required"                          | `addClientAuthentication` is defined        | Remove the method entirely                              |
| "Existing OAuth client information is required"  | Client info cleared during exchange         | Implement `isExchangingCode` protection                 |
| "StreamableHTTPClientTransport already started!" | Reusing transport after `finishAuth`        | Create new transport/client                             |
| "Code verifier not found"                        | Verifier cleared by `invalidateCredentials` | Preserve verifier during exchange                       |
| "This site can't be reached"                     | Callback server shut down                   | This is normal - server shuts down after capturing code |

## References

- [MCP SDK Source](https://github.com/modelcontextprotocol/sdk)
- [OAuth 2.1 Spec](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1)
- [RFC 7591 Dynamic Registration](https://datatracker.ietf.org/doc/html/rfc7591)
- [PKCE RFC 7636](https://datatracker.ietf.org/doc/html/rfc7636)

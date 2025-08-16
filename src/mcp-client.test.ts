/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { browserAuth, inMemoryStore } from "oauth-callback/mcp";
import { MockOAuthServer } from "../test/utils/mock-oauth-server";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

describe("OAuth Authentication", () => {
  let mockServer: MockOAuthServer;
  let store: any;
  let provider: any;
  const mockServerUrl = "http://localhost:8080";

  beforeEach(() => {
    mockServer = new MockOAuthServer({
      baseUrl: mockServerUrl,
      requireClientAuth: false,
    });
    store = inMemoryStore();
    provider = browserAuth({
      port: 3000,
      store,
      scope: "read write",
    });
  });

  afterEach(() => {
    mockServer.reset();
  });

  describe("browserAuth provider", () => {
    test("performs dynamic client registration", async () => {
      // Initially no client info
      const initialInfo = await provider.clientInformation();
      expect(initialInfo).toBeUndefined();

      // Save client information after registration
      const clientInfo: OAuthClientInformationFull = {
        client_id: "test-client-123",
        client_name: "test-client",
        client_id_issued_at: Date.now() / 1000,
        redirect_uris: ["http://localhost:3000/callback"],
      };

      await provider.saveClientInformation(clientInfo);

      // Verify it was saved
      const savedInfo = await provider.clientInformation();
      expect(savedInfo).toBeDefined();
      expect(savedInfo?.client_id).toBe("test-client-123");
    });

    test("handles PKCE flow correctly", async () => {
      // Save code verifier
      const testVerifier = "test-verifier-123456789";
      await provider.saveCodeVerifier(testVerifier);

      // Retrieve code verifier
      const retrieved = await provider.codeVerifier();
      expect(retrieved).toBe(testVerifier);
    });

    test("manages OAuth tokens", async () => {
      // Initially no tokens
      const initialTokens = await provider.tokens();
      expect(initialTokens).toBeUndefined();

      // Save tokens after authorization
      const tokens: OAuthTokens = {
        access_token: "access-token-123",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "refresh-token-456",
        scope: "read write",
      };

      await provider.saveTokens(tokens);

      // Verify tokens were saved
      const savedTokens = await provider.tokens();
      expect(savedTokens).toBeDefined();
      expect(savedTokens?.access_token).toBe("access-token-123");
      expect(savedTokens?.refresh_token).toBe("refresh-token-456");
    });

    test("generates random state parameter", async () => {
      const state1 = await provider.state();
      const state2 = await provider.state();

      expect(state1).toBeTruthy();
      expect(state2).toBeTruthy();
      expect(state1).not.toBe(state2);
      // State should be URL-safe base64
      expect(state1).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    test("invalidates credentials by scope", async () => {
      // Setup initial data
      const clientInfo: OAuthClientInformationFull = {
        client_id: "client-123",
        client_secret: "secret-456",
        client_name: "test",
        client_id_issued_at: Date.now() / 1000,
        redirect_uris: ["http://localhost:3000/callback"],
      };
      const tokens: OAuthTokens = {
        access_token: "access-123",
        token_type: "Bearer",
        refresh_token: "refresh-456",
      };

      await provider.saveClientInformation(clientInfo);
      await provider.saveTokens(tokens);
      await provider.saveCodeVerifier("verifier-789");

      // Test invalidating tokens only
      await provider.invalidateCredentials("tokens");
      const tokensAfter = await provider.tokens();
      expect(tokensAfter).toBeUndefined();

      const clientAfter = await provider.clientInformation();
      expect(clientAfter?.client_id).toBe("client-123");

      // Test invalidating all
      await provider.invalidateCredentials("all");
      const allAfter = await provider.clientInformation();
      const allTokens = await provider.tokens();

      expect(allAfter).toBeUndefined();
      expect(allTokens).toBeUndefined();
    });
  });

  describe("MockOAuthServer", () => {
    test("provides OAuth metadata discovery", async () => {
      // Test Protected Resource Metadata
      const resourceReq = new Request(
        `${mockServerUrl}/.well-known/oauth-protected-resource`,
      );
      const resourceRes = await mockServer.handleRequest(resourceReq);

      expect(resourceRes.status).toBe(200);
      const resourceData = await resourceRes.json();
      expect((resourceData as any).resource).toBe(mockServerUrl);
      expect((resourceData as any).authorization_servers).toContain(
        mockServerUrl,
      );

      // Test Authorization Server Metadata
      const authReq = new Request(
        `${mockServerUrl}/.well-known/oauth-authorization-server`,
      );
      const authRes = await mockServer.handleRequest(authReq);

      expect(authRes.status).toBe(200);
      const authData = await authRes.json();
      expect((authData as any).issuer).toBe(mockServerUrl);
      expect((authData as any).authorization_endpoint).toBe(
        `${mockServerUrl}/authorize`,
      );
      expect((authData as any).token_endpoint).toBe(`${mockServerUrl}/token`);
      expect((authData as any).code_challenge_methods_supported).toContain(
        "S256",
      );
    });

    test("handles dynamic client registration", async () => {
      const clientMetadata = {
        client_name: "Test App",
        redirect_uris: ["http://localhost:3000/callback"],
        scope: "read write",
      };

      const req = new Request(`${mockServerUrl}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(clientMetadata),
      });

      const res = await mockServer.handleRequest(req);

      expect(res.status).toBe(201);
      const clientInfo = await res.json();
      expect((clientInfo as any).client_id).toBeTruthy();
      expect((clientInfo as any).client_name).toBe("Test App");
      expect((clientInfo as any).client_id_issued_at).toBeTruthy();
    });

    test("handles authorization code exchange", async () => {
      // First register a client
      const registerReq = new Request(`${mockServerUrl}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: "Test",
          redirect_uris: ["http://localhost:3000/callback"],
        }),
      });

      const registerRes = await mockServer.handleRequest(registerReq);
      const clientInfo = await registerRes.json();

      // Simulate authorization
      const codeVerifier = "test-verifier-123456789012345678901234567890123";
      const codeChallenge = Buffer.from(codeVerifier).toString("base64url");

      const authCode = mockServer.simulateAuthorization({
        clientId: (clientInfo as any).client_id,
        redirectUri: "http://localhost:3000/callback",
        codeChallenge,
        codeChallengeMethod: "S256",
        scope: "read write",
      });

      // Exchange code for tokens
      const tokenReq = new Request(`${mockServerUrl}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: authCode,
          code_verifier: codeVerifier,
          redirect_uri: "http://localhost:3000/callback",
          client_id: (clientInfo as any).client_id,
        }).toString(),
      });

      const tokenRes = await mockServer.handleRequest(tokenReq);

      expect(tokenRes.status).toBe(200);
      const tokens = await tokenRes.json();
      expect((tokens as any).access_token).toBeTruthy();
      expect((tokens as any).token_type).toBe("Bearer");
      expect((tokens as any).refresh_token).toBeTruthy();
    });

    test("handles refresh token grant", async () => {
      // Setup: Register client and get initial tokens
      const registerReq = new Request(`${mockServerUrl}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: "Test",
          redirect_uris: ["http://localhost:3000/callback"],
        }),
      });

      const registerRes = await mockServer.handleRequest(registerReq);
      const clientInfo = await registerRes.json();

      const codeVerifier = "test-verifier";
      const authCode = mockServer.simulateAuthorization({
        clientId: (clientInfo as any).client_id,
        redirectUri: "http://localhost:3000/callback",
        codeChallenge: Buffer.from(codeVerifier).toString("base64url"),
        codeChallengeMethod: "S256",
      });

      const initialTokenReq = new Request(`${mockServerUrl}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: authCode,
          code_verifier: codeVerifier,
          redirect_uri: "http://localhost:3000/callback",
          client_id: (clientInfo as any).client_id,
        }).toString(),
      });

      const initialTokenRes = await mockServer.handleRequest(initialTokenReq);
      const initialTokens = await initialTokenRes.json();

      // Test refresh token grant
      const refreshReq = new Request(`${mockServerUrl}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: (initialTokens as any).refresh_token,
          client_id: (clientInfo as any).client_id,
        }).toString(),
      });

      const refreshRes = await mockServer.handleRequest(refreshReq);

      expect(refreshRes.status).toBe(200);
      const newTokens = await refreshRes.json();
      expect((newTokens as any).access_token).toBeTruthy();
      expect((newTokens as any).access_token).not.toBe(
        (initialTokens as any).access_token,
      );
      expect((newTokens as any).refresh_token).toBe(
        (initialTokens as any).refresh_token,
      ); // Same refresh token
    });

    test("rejects invalid authorization code", async () => {
      const tokenReq = new Request(`${mockServerUrl}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: "invalid-code",
          code_verifier: "verifier",
          redirect_uri: "http://localhost:3000/callback",
          client_id: "client-123",
        }).toString(),
      });

      const tokenRes = await mockServer.handleRequest(tokenReq);

      expect(tokenRes.status).toBe(401);
      const error = await tokenRes.json();
      expect((error as any).error).toBe("invalid_client");
    });
  });
});

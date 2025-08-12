/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { McpOAuthProvider, InMemoryOAuthStorage } from "./oauth-provider";
import { MockOAuthServer } from "./test-utils/mock-oauth-server";
import { createMcpConnection, McpClientManager } from "./mcp-client";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/dist/esm/shared/auth.js";
import type { McpServer } from "./types";

describe("OAuth Authentication", () => {
  let mockServer: MockOAuthServer;
  let storage: InMemoryOAuthStorage;
  let provider: McpOAuthProvider;
  const mockServerUrl = "http://localhost:8080";

  beforeEach(() => {
    mockServer = new MockOAuthServer({
      baseUrl: mockServerUrl,
      requireClientAuth: false,
    });
    storage = new InMemoryOAuthStorage();
    provider = new McpOAuthProvider({
      redirectUrl: "http://localhost:3000/callback",
      clientMetadata: {
        client_name: "test-client",
        redirect_uris: ["http://localhost:3000/callback"],
        scope: "read write",
      },
      storage,
    });
  });

  afterEach(() => {
    mockServer.reset();
  });

  describe("McpOAuthProvider", () => {
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
      expect(tokensAfter?.access_token).toBe("");

      const clientAfter = await provider.clientInformation();
      expect(clientAfter?.client_id).toBe("client-123");

      // Test invalidating all
      await provider.invalidateCredentials("all");
      const allAfter = await storage.getClientInfo();
      const allTokens = await storage.getTokens();
      const allVerifier = await storage.getCodeVerifier();

      expect(allAfter).toBeUndefined();
      expect(allTokens).toBeUndefined();
      expect(allVerifier).toBeUndefined();
    });

    test("handles redirect to authorization", async () => {
      let capturedUrl: URL | undefined;

      const customProvider = new McpOAuthProvider({
        redirectUrl: "http://localhost:3000/callback",
        clientMetadata: {
          client_name: "test-client",
          redirect_uris: ["http://localhost:3000/callback"],
        },
        onRedirect: async (url) => {
          capturedUrl = url;
        },
      });

      const authUrl = new URL("https://example.com/authorize?client_id=123");
      await customProvider.redirectToAuthorization(authUrl);

      expect(capturedUrl).toBeDefined();
      expect(capturedUrl?.href).toBe(authUrl.href);
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
      expect(resourceData.resource).toBe(mockServerUrl);
      expect(resourceData.authorization_servers).toContain(mockServerUrl);

      // Test Authorization Server Metadata
      const authReq = new Request(
        `${mockServerUrl}/.well-known/oauth-authorization-server`,
      );
      const authRes = await mockServer.handleRequest(authReq);

      expect(authRes.status).toBe(200);
      const authData = await authRes.json();
      expect(authData.issuer).toBe(mockServerUrl);
      expect(authData.authorization_endpoint).toBe(
        `${mockServerUrl}/authorize`,
      );
      expect(authData.token_endpoint).toBe(`${mockServerUrl}/token`);
      expect(authData.code_challenge_methods_supported).toContain("S256");
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
      expect(clientInfo.client_id).toBeTruthy();
      expect(clientInfo.client_name).toBe("Test App");
      expect(clientInfo.client_id_issued_at).toBeTruthy();
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
        clientId: clientInfo.client_id,
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
          client_id: clientInfo.client_id,
        }).toString(),
      });

      const tokenRes = await mockServer.handleRequest(tokenReq);

      expect(tokenRes.status).toBe(200);
      const tokens = await tokenRes.json();
      expect(tokens.access_token).toBeTruthy();
      expect(tokens.token_type).toBe("Bearer");
      expect(tokens.refresh_token).toBeTruthy();
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
        clientId: clientInfo.client_id,
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
          client_id: clientInfo.client_id,
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
          refresh_token: initialTokens.refresh_token,
          client_id: clientInfo.client_id,
        }).toString(),
      });

      const refreshRes = await mockServer.handleRequest(refreshReq);

      expect(refreshRes.status).toBe(200);
      const newTokens = await refreshRes.json();
      expect(newTokens.access_token).toBeTruthy();
      expect(newTokens.access_token).not.toBe(initialTokens.access_token);
      expect(newTokens.refresh_token).toBe(initialTokens.refresh_token); // Same refresh token
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
      expect(error.error).toBe("invalid_client");
    });
  });

  describe("McpClientManager", () => {
    test("manages multiple server connections", async () => {
      const manager = new McpClientManager({
        name: "test-manager",
        version: "1.0.0",
      });

      // Mock servers
      const servers: McpServer[] = [
        { type: "http", url: "http://server1.example.com" },
        { type: "http", url: "http://server2.example.com" },
      ];

      // Note: In a real test, we'd need to mock the actual connection
      // For now, just test the manager's interface
      expect(manager.getAllConnections()).toHaveLength(0);

      // Test getting non-existent connection
      const connection = manager.getConnection("http://server1.example.com");
      expect(connection).toBeUndefined();
    });

    test("provides tool discovery across connections", () => {
      const manager = new McpClientManager();
      const allTools = manager.getAllTools();

      expect(Array.isArray(allTools)).toBe(true);
      expect(allTools).toHaveLength(0);
    });

    test("handles disconnection gracefully", async () => {
      const manager = new McpClientManager();

      // Disconnect from non-existent server should not throw
      await expect(
        manager.disconnect("http://nonexistent.com"),
      ).resolves.toBeUndefined();

      // Disconnect all with no connections should not throw
      await expect(manager.disconnectAll()).resolves.toBeUndefined();
    });
  });
});

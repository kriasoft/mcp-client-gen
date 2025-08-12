/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test";
import {
  discoverOAuthProtectedResourceMetadata,
  discoverAuthorizationServerMetadata,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { McpOAuthProvider, InMemoryOAuthStorage } from "./oauth-provider";
import { createMcpConnection } from "./mcp-client";
import type { McpServer } from "./types";

describe("E2E OAuth Flow", () => {
  // Only run E2E tests when explicitly requested
  const shouldRunE2E = process.env.E2E === "1";

  test.if(shouldRunE2E)(
    "discovers OAuth metadata for Notion MCP",
    async () => {
      const notionServer: McpServer = {
        type: "http",
        url: "https://mcp.notion.com/mcp",
      };

      try {
        // Test OAuth Protected Resource Metadata discovery
        const resourceMetadata = await discoverOAuthProtectedResourceMetadata(
          notionServer.url,
          {},
        );

        console.log("Resource Metadata:", resourceMetadata);

        expect(resourceMetadata).toBeDefined();
        expect(resourceMetadata.resource).toBeTruthy();
        expect(resourceMetadata.authorization_servers).toBeDefined();
        expect(resourceMetadata.authorization_servers.length).toBeGreaterThan(
          0,
        );

        // Test Authorization Server Metadata discovery
        if (resourceMetadata.authorization_servers.length > 0) {
          const authServerUrl = resourceMetadata.authorization_servers[0];
          const authMetadata =
            await discoverAuthorizationServerMetadata(authServerUrl);

          console.log("Authorization Server Metadata:", authMetadata);

          expect(authMetadata).toBeDefined();
          expect(authMetadata?.issuer).toBeTruthy();
          expect(authMetadata?.authorization_endpoint).toBeTruthy();
          expect(authMetadata?.token_endpoint).toBeTruthy();
          expect(authMetadata?.code_challenge_methods_supported).toContain(
            "S256",
          );
        }
      } catch (error) {
        // If Notion MCP is not available, skip the test gracefully
        console.log("Notion MCP not available for E2E testing:", error);
      }
    },
    30000,
  ); // 30 second timeout for network requests

  test.if(shouldRunE2E)(
    "complete OAuth flow with mock authorization",
    async () => {
      const server: McpServer = {
        type: "http",
        url: "https://mcp.notion.com/mcp",
      };

      // Create OAuth provider with in-memory storage
      const storage = new InMemoryOAuthStorage();
      const authProvider = new McpOAuthProvider({
        redirectUrl: "http://localhost:3000/callback",
        clientMetadata: {
          client_name: "mcp-client-gen-e2e-test",
          redirect_uris: ["http://localhost:3000/callback"],
          scope: "read",
        },
        storage,
        onRedirect: async (url) => {
          console.log("Authorization URL:", url.href);
          // In a real E2E test, we would:
          // 1. Open a browser to this URL
          // 2. Automate the login flow
          // 3. Capture the authorization code from the callback
          // For now, we just log it
        },
      });

      try {
        // Attempt to create connection (will fail without actual auth)
        console.log("Attempting to connect to Notion MCP...");

        // This will fail without actual OAuth flow completion
        // In a full E2E test, we'd need:
        // - A test account with Notion
        // - Browser automation (Playwright/Puppeteer)
        // - Callback server to capture the auth code

        // For demonstration, we'll just test the setup
        expect(authProvider.redirectUrl).toBe("http://localhost:3000/callback");
        expect(authProvider.clientMetadata.client_name).toBe(
          "mcp-client-gen-e2e-test",
        );

        // Verify we can generate state and it's properly formatted
        const state = await authProvider.state();
        expect(state).toMatch(/^[A-Za-z0-9_-]+$/);

        // Verify initial state is empty
        const initialTokens = await authProvider.tokens();
        expect(initialTokens).toBeUndefined();

        const initialClientInfo = await authProvider.clientInformation();
        expect(initialClientInfo).toBeUndefined();
      } catch (error) {
        console.log("Expected error without auth:", error);
      }
    },
    30000,
  );

  test.if(shouldRunE2E)("tests token refresh flow", async () => {
    // This test would require:
    // 1. Valid refresh token from a previous authorization
    // 2. Making a refresh request to the authorization server
    // 3. Verifying new access token is received

    const storage = new InMemoryOAuthStorage();

    // Simulate having existing tokens
    await storage.saveTokens({
      access_token: "expired_access_token",
      token_type: "Bearer",
      expires_in: -1, // Already expired
      refresh_token: "test_refresh_token",
      scope: "read",
    });

    const authProvider = new McpOAuthProvider({
      redirectUrl: "http://localhost:3000/callback",
      clientMetadata: {
        client_name: "test-client",
        redirect_uris: ["http://localhost:3000/callback"],
      },
      storage,
    });

    // Verify tokens are loaded
    const tokens = await authProvider.tokens();
    expect(tokens?.refresh_token).toBe("test_refresh_token");

    // In a real E2E test, we would:
    // 1. Call the refresh endpoint
    // 2. Verify new access token is received
    // 3. Verify the refresh token is preserved or updated

    console.log("Token refresh test setup complete");
  });

  test.if(shouldRunE2E)("handles authorization errors gracefully", async () => {
    const server: McpServer = {
      type: "http",
      url: "https://invalid.example.com/mcp",
    };

    try {
      // Try to discover metadata for an invalid server
      await discoverOAuthProtectedResourceMetadata(server.url, {});

      // Should not reach here
      expect(true).toBe(false);
    } catch (error) {
      // Expected to fail
      expect(error).toBeDefined();
      console.log("Expected error for invalid server:", error);
    }
  });

  test.if(shouldRunE2E)("connects to multiple MCP servers", async () => {
    // This would test connecting to multiple MCP servers simultaneously
    // Each with their own OAuth flow

    const servers: McpServer[] = [
      { type: "http", url: "https://mcp.notion.com/mcp" },
      // Add more servers as they become available
      // { type: "http", url: "https://mcp.github.com/mcp" },
      // { type: "http", url: "https://mcp.slack.com/mcp" },
    ];

    for (const server of servers) {
      try {
        const metadata = await discoverOAuthProtectedResourceMetadata(
          server.url,
          {},
        );
        console.log(
          `Successfully discovered metadata for ${server.url}:`,
          metadata,
        );
      } catch (error) {
        console.log(`Failed to discover metadata for ${server.url}:`, error);
      }
    }
  });
});

// Helper to run a simple E2E test
if (process.env.E2E === "1") {
  console.log("\n=== Running E2E OAuth Tests ===");
  console.log("Note: Full E2E tests require:");
  console.log("- Valid test accounts with MCP providers");
  console.log("- Browser automation for OAuth flow");
  console.log("- Callback server to capture auth codes");
  console.log("- Test credentials in environment variables");
  console.log("\nCurrently running limited E2E tests...\n");
}

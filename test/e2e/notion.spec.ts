import { test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { browserAuth, inMemoryStore } from "oauth-callback/mcp";

/**
 * Manual OAuth flow example - demonstrates onRedirect handler
 * @skip This test shows manual OAuth handling without automatic callback
 */
test.skip(
  "Notion MCP Manual OAuth Flow (onRedirect)",
  async () => {
    console.log("Testing manual OAuth flow (user handles redirect)...");

    const store = inMemoryStore();

    // Manual OAuth flow - user handles the redirect
    const authProvider = browserAuth({
      port: 3000,
      store,
      scope: "read:page:metadata read:database:metadata",
      openBrowser: false, // Manual handling
    });

    const transport = new StreamableHTTPClientTransport(
      new URL("https://mcp.notion.com/mcp"),
      { authProvider },
    );

    const client = new Client(
      { name: "test-client", version: "1.0.0" },
      { capabilities: {} },
    );

    try {
      console.log("Attempting to connect...");
      await client.connect(transport);
      console.log("Connected successfully!");

      const capabilities = client.getServerCapabilities();
      console.log("Server capabilities:", capabilities);

      await client.close();
    } catch (error: any) {
      console.log("Manual flow error:", error.message);
      console.log("This is expected when user doesn't complete authorization.");
    }
  },
  { timeout: 30000 },
);

/**
 * Automatic E2E test for Notion OAuth flow with callback handling
 * @requires User interaction for browser auth
 * @skip Enable with test.only() for manual testing
 */
test.only(
  "Notion MCP Introspection E2E with OAuth Callback",
  async () => {
    console.log(
      "Setting up OAuth provider with automatic callback handling...",
    );

    const store = inMemoryStore();

    // Auto-callback spawns local server for redirect capture
    const authProvider = browserAuth({
      port: 3000,
      store,
      scope: "read:page:metadata read:database:metadata",
      openBrowser: true,
      authTimeout: 120000, // User has 2min to authorize
    });

    const transport = new StreamableHTTPClientTransport(
      new URL("https://mcp.notion.com/mcp"),
      { authProvider },
    );

    const client = new Client(
      { name: "test-client", version: "1.0.0" },
      { capabilities: {} },
    );

    try {
      console.log("Attempting to connect to Notion MCP server...");
      console.log("The OAuth flow will automatically:");
      console.log("1. Open your browser for authorization");
      console.log("2. Start a local callback server on port 3000");
      console.log("3. Capture the authorization code when you approve");
      console.log("4. Complete the token exchange");
      console.log("\nPlease complete the authorization in your browser...\n");

      await client.connect(transport);
      console.log("✅ Connected successfully!");

      const capabilities = client.getServerCapabilities();
      console.log(
        "\n📋 Server capabilities:",
        JSON.stringify(capabilities, null, 2),
      );

      // List available tools
      if (capabilities?.tools) {
        const toolsResult = await client.listTools();
        console.log(
          "\n🔧 Available tools:",
          toolsResult.tools.map((t) => t.name),
        );
      }

      // List available resources
      if (capabilities?.resources) {
        const resourcesResult = await client.listResources();
        console.log(
          "\n📚 Available resources:",
          resourcesResult.resources.map((r) => r.uri),
        );
      }

      // Verify OAuth flow completed successfully
      const clientInfo = await storage.getClientInfo();
      const tokens = await storage.getTokens();

      console.log("\n✅ Client registered:", !!clientInfo);
      console.log("✅ Tokens received:", !!tokens);

      await client.close();
      console.log("\n🎉 Test completed successfully!");
    } catch (error: any) {
      console.error("\n❌ OAuth flow test failed:", error.message);
      console.error("Error type:", error.constructor.name);
      if (error.stack) {
        console.error("Stack trace:", error.stack);
      }
      throw error;
    }
  },
  { timeout: 120000 },
); // 2 minute timeout for manual login

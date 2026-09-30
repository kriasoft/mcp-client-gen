#!/usr/bin/env bun
/**
 * End-to-end test for generated Notion client.
 *
 * Connects to real Notion MCP server and makes actual API calls.
 * Requires OAuth authentication (browser will open on first run).
 *
 * Usage: bun run test/manual/e2e-notion.ts
 */

import { createNotionClient } from "../../examples/notion-client";
import { resolve } from "node:path";
import { createMcpConnection, fileStore } from "../../src/index";

async function main() {
  console.log("E2E test: Generated Notion client\n");

  // Step 1: Connect to Notion MCP server
  console.log("1. Connecting to Notion MCP server...");
  console.log(
    "   (Browser will open for OAuth if not already authenticated)\n",
  );
  const connection = await createMcpConnection(
    { type: "http", url: "https://mcp.notion.com/mcp" },
    {
      oauth: {
        // fileStore() needs an absolute path; the file is gitignored
        store: () => fileStore(resolve(".oauth-credentials.json")),
        timeout: 120000,
      },
    },
  );
  console.log("   Connected successfully");
  console.log(
    `   Server capabilities: ${Object.keys(connection.capabilities).join(", ") || "(none)"}`,
  );

  // Step 2: Create typed client
  console.log("\n2. Creating typed Notion client...");
  const notion = createNotionClient(connection);
  console.log("   Client created");

  // Step 3: Make actual API call
  console.log("\n3. Calling notionGetUsers({ user_id: 'self' })...");
  try {
    const result = await notion.notionGetUsers({ user_id: "self" });
    console.log("   Response received:");
    console.log(
      `   ${JSON.stringify(result, null, 2).split("\n").join("\n   ")}`,
    );
  } catch (error) {
    console.error(
      `   Error: ${error instanceof Error ? error.message : error}`,
    );
    await connection.client.close();
    process.exit(1);
  }

  // Close connection to allow process exit
  await connection.client.close();

  console.log("\nE2E test passed!");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

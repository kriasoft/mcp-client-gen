#!/usr/bin/env bun
/**
 * End-to-end test for the generated Notion client.
 *
 * Connects to the real Notion MCP server the way an app would (SDK Client +
 * oauth-callback) and makes an actual call. The browser opens on first run.
 *
 * Usage: bun run test/manual/e2e-notion.ts
 */

import { Client } from "@modelcontextprotocol/client";
import { browserAuth, fileStore } from "oauth-callback/mcp";
import { resolve } from "node:path";
import { createNotionClient } from "../../examples/notion-client";

async function main() {
  console.log("E2E test: Generated Notion client\n");

  console.log("1. Connecting to Notion MCP server...");
  console.log(
    "   (Browser will open for OAuth if not already authenticated)\n",
  );
  const client = new Client({ name: "mcp-client-gen-e2e", version: "1.0.0" });
  await browserAuth({
    serverUrl: "https://mcp.notion.com/mcp",
    redirectUri: "http://127.0.0.1:3000/callback",
    clientName: "mcp-client-gen-e2e",
    // fileStore() needs an absolute path; the file is gitignored
    store: fileStore(resolve(".oauth-credentials.json")),
    timeout: 120_000,
  }).connect(client);
  console.log("   Connected successfully");

  try {
    const notion = createNotionClient(client);
    console.log("\n2. Calling notionGetUsers({ user_id: 'self' })...");
    const result = await notion.notionGetUsers({ user_id: "self" });
    if (result.isError) throw new Error(JSON.stringify(result.content));
    console.log(
      `   ${JSON.stringify(result.content, null, 2).split("\n").join("\n   ")}`,
    );
  } finally {
    await client.close(); // allow process exit
  }

  console.log("\nE2E test passed!");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

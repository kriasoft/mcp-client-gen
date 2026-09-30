#!/usr/bin/env bun
/**
 * Smoke test for generated Notion client.
 *
 * Verifies the generated client:
 * 1. Compiles without TypeScript errors
 * 2. Can be instantiated with a mock connection
 * 3. Has expected methods available
 *
 * Usage: bun run test/manual/smoke-notion.ts
 */

import type { Client } from "@modelcontextprotocol/client";
import { createNotionClient, NotionClient } from "../../examples/notion-client";

// Mock MCP connection for smoke testing
const mockConnection = {
  client: {} as Client,
  server: { type: "http" as const, url: "https://example.com" },
  capabilities: {},
  tools: [],
  resources: [],
  prompts: [],
};

console.log("Smoke test: Generated Notion client\n");

// Test 1: Client instantiation
console.log("1. Testing client instantiation...");
const client = createNotionClient(mockConnection);

if (!(client instanceof NotionClient)) {
  console.error(
    "   FAIL: createNotionClient did not return NotionClient instance",
  );
  process.exit(1);
}
console.log("   PASS: Client instantiated successfully");

// Test 2: Verify expected methods exist
console.log("2. Testing method availability...");
const expectedMethods = [
  "notionSearch",
  "notionFetch",
  "notionCreatePages",
  "notionUpdatePage",
  "notionMovePages",
  "notionDuplicatePage",
  "notionCreateDatabase",
  "notionUpdateDatabase",
  "notionCreateComment",
  "notionGetComments",
  "notionGetTeams",
  "notionGetUsers",
  "getResource",
  "getEnhancedMarkdownSpecification",
];

const missingMethods = expectedMethods.filter(
  (method) => typeof (client as any)[method] !== "function",
);

if (missingMethods.length > 0) {
  console.error(`   FAIL: Missing methods: ${missingMethods.join(", ")}`);
  process.exit(1);
}
console.log(
  `   PASS: All ${expectedMethods.length} expected methods available`,
);

// Test 3: Verify client property access
console.log("3. Testing client property access...");
if (client.client !== mockConnection.client) {
  console.error("   FAIL: client.client does not match connection");
  process.exit(1);
}
console.log("   PASS: Client property accessible");

console.log("\nAll smoke tests passed!");

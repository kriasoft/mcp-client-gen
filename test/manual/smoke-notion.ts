#!/usr/bin/env bun
/**
 * Smoke test for generated Notion client.
 *
 * Verifies the generated client:
 * 1. Compiles without TypeScript errors
 * 2. Can be created from an SDK client
 * 3. Has expected methods available
 *
 * Usage: bun run test/manual/smoke-notion.ts
 */

import type { Client } from "@modelcontextprotocol/client";
import {
  createNotionClient,
  type NotionClient,
} from "../../examples/notion-client";

console.log("Smoke test: Generated Notion client\n");

// Test 1: Client creation (methods only touch the SDK client when called)
console.log("1. Testing client creation...");
const client: NotionClient = createNotionClient({} as Client);
console.log("   PASS: Client created successfully");

// Test 2: Verify expected methods exist
console.log("2. Testing method availability...");
const expectedMethods = [
  "search",
  "fetch",
  "createPages",
  "updatePage",
  "movePages",
  "duplicatePage",
  "createDatabase",
  "updateDatabase",
  "createComment",
  "getComments",
  "getTeams",
  "getUsers",
  "readResource",
  "readEnhancedMarkdownSpecification",
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

console.log("\nAll smoke tests passed!");

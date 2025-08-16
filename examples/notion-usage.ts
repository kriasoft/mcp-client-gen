/**
 * MCP Client for Notion usage example.
 *
 * SPDX-FileCopyrightText: 2025-present Kriasoft
 * SPDX-License-Identifier: MIT
 */

import type { FetchOutput } from "./notion";
import { NotionClient } from "./notion";

// Example 1: Basic usage
async function basicExample() {
  // The client automatically disconnects when it goes out of scope
  await using client = new NotionClient();

  const page = await client.fetch({ id: "page-123" });
  console.log("Page content:", page);
}

// Example 2: With authentication (OAuth)
async function withAuth() {
  // For OAuth, you'd pass an authProvider
  // import { browserAuth } from "oauth-callback/mcp";
  // const authProvider = browserAuth({ port: 3000, ... });

  await using client = new NotionClient({
    url: process.env.NOTION_URL,
    // authProvider: authProvider  // OAuth authentication
  });

  const page = await client.fetch({ id: "page-456" });
  console.log("Page content:", page);
}

// Example 3: Type-safe responses
async function typedExample() {
  // Define your expected response type
  interface MyPageType extends FetchOutput {
    title: string;
    content: string;
    author: { name: string; email: string };
  }

  await using client = new NotionClient();

  // Pass the type as a generic parameter
  const page = await client.fetch<MyPageType>({ id: "page-789" });

  // TypeScript now knows the structure
  console.log(page.title); // TypeScript knows about title
  console.log(page.author.name); // Fully typed
}

// Example 4: Error handling with 'await using'
async function errorHandling() {
  try {
    await using client = new NotionClient();

    const page = await client.fetch({ id: "invalid-id" });
    console.log("Success:", page);
  } catch (error: any) {
    // Handle different error types
    if (error.code === "NOT_FOUND") {
      console.error("Page not found");
    } else if (error.code === "UNAUTHORIZED") {
      console.error("Authentication failed");
    } else if (error.code === "ECONNREFUSED") {
      console.error("Connection failed - is the server running?");
    } else {
      console.error("Unexpected error:", error.message);
    }
  }
  // Client automatically disconnects even if error occurs
}

// Example 5: Multiple operations
async function multipleOperations() {
  await using client = new NotionClient();

  // The client maintains connection across multiple calls
  const page1 = await client.fetch({ id: "page-1" });
  const page2 = await client.fetch({ id: "page-2" });
  const page3 = await client.fetch({ id: "page-3" });

  console.log("Fetched 3 pages:", { page1, page2, page3 });
  // Automatic disconnect when scope ends
}

// Example 6: Manual cleanup (when you can't use 'await using')
async function manualCleanup() {
  // If you need to use the client in a context where 'await using' isn't available
  // or you're using an older TypeScript version (< 5.2), use try/finally:

  const client = new NotionClient();
  try {
    const page = await client.fetch({ id: "page-123" });
    console.log("Page fetched:", page);
  } finally {
    // Explicitly disconnect when not using 'await using'
    await client.disconnect();
  }
}

// Run examples if this file is executed directly
if (import.meta.main) {
  console.log("Running MCP Client examples...\n");

  await basicExample();
  // await withAuth();
  // await typedExample();
  // await errorHandling();
}

/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * Generates a client from the real Notion MCP server through the browser OAuth flow.
 * Interactive (you approve in the browser), so opt in: NOTION_E2E=1 bun test:e2e
 */

import { expect, test } from "bun:test";
import { generateClientModule } from "../../src/index";

test.skipIf(!process.env.NOTION_E2E)(
  "generates a Notion client after browser OAuth",
  async () => {
    const code = await generateClientModule("https://mcp.notion.com/mcp", {
      oauth: { timeout: 120_000 }, // time to approve in the browser
    });

    expect(code).toContain(
      "export function createNotionClient(client: Client)",
    );
    expect(code).toContain("search(input: SearchInput");
  },
  { timeout: 150_000 },
);

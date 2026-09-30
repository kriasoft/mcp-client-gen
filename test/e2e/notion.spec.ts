/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * Introspects the real Notion MCP server through the browser OAuth flow.
 * Interactive (you approve in the browser), so opt in: NOTION_E2E=1 bun test:e2e
 */

import { expect, test } from "bun:test";
import { createMcpConnection } from "../../src/index";

test.skipIf(!process.env.NOTION_E2E)(
  "introspects Notion MCP after browser OAuth",
  async () => {
    const connection = await createMcpConnection(
      { type: "http", url: "https://mcp.notion.com/mcp" },
      { oauth: { timeout: 120_000 } }, // time to approve in the browser
    );

    try {
      expect(connection.capabilities.tools).toBeDefined();
      expect(connection.tools.length).toBeGreaterThan(0);
    } finally {
      await connection.client.close();
    }
  },
  { timeout: 150_000 },
);

/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import type { Tool } from "@modelcontextprotocol/client";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { McpServerConfig } from "./types.js";

const tools: Tool[] = [{ name: "read_file", inputSchema: { type: "object" } }];
const close = mock(() => Promise.resolve());
const createMcpConnection = mock(async () => ({
  client: { close },
  capabilities: { tools: {} },
  tools,
  resources: [],
  resourceTemplates: [],
  prompts: [],
  authorized: true,
}));
mock.module("./mcp-client.js", () => ({ createMcpConnection }));

const { introspectServer } = await import("./introspection.js");
const server: McpServerConfig = { url: "https://example.test/mcp" };

describe("introspectServer", () => {
  beforeEach(() => {
    close.mockClear();
    createMcpConnection.mockClear();
  });

  test("returns the snapshot without the client, then disconnects", async () => {
    const config = { timeout: 5 };
    expect(await introspectServer(server, config)).toEqual({
      capabilities: { tools: {} },
      tools,
      resources: [],
      resourceTemplates: [],
      prompts: [],
      authorized: true,
    });
    expect(createMcpConnection).toHaveBeenCalledWith(server, config);
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("ignores errors when disconnecting", async () => {
    close.mockImplementationOnce(() => Promise.reject(new Error("closed")));
    expect((await introspectServer(server)).tools).toBe(tools);
  });

  test("propagates connection errors unchanged", async () => {
    const error = new TypeError("fetch failed", { cause: "ECONNREFUSED" });
    createMcpConnection.mockImplementationOnce(() => Promise.reject(error));
    await expect(introspectServer(server)).rejects.toBe(error);
  });
});

/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import type {
  Prompt,
  Resource,
  ServerCapabilities,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, mock, test } from "bun:test";
import { introspectServer, introspectServers } from "./introspection.js";
import * as mcpClient from "./mcp-client.js";
import type { McpServerConfig } from "./types.js";

// Sample data for tests (defined before mockConnection)
const mockCapabilities: ServerCapabilities = {
  tools: { listChanged: true },
  resources: { subscribe: true },
  prompts: {},
};

const mockTools: Tool[] = [
  {
    name: "create_file",
    description: "Create a new file",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "read_file",
    description: "Read file contents",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
      },
      required: ["path"],
    },
  },
];

const mockResources: Resource[] = [
  {
    uri: "file:///Users/test/project",
    name: "Project Directory",
    description: "Root project directory",
    mimeType: "text/directory",
  },
];

const mockPrompts: Prompt[] = [
  {
    name: "code_review",
    description: "Review code for quality",
    arguments: [
      {
        name: "code",
        description: "The code to review",
        required: true,
      },
    ],
  },
];

// Mock connection object
const mockConnection = {
  client: {
    close: mock(() => Promise.resolve()),
    getServerCapabilities: () => mockCapabilities,
  },
  server: { type: "http" as const, url: "http://localhost:3000" },
  capabilities: mockCapabilities,
  tools: mockTools,
  resources: mockResources,
  prompts: mockPrompts,
};

// Mock the mcp-client module
mock.module("./mcp-client.js", () => ({
  createMcpConnection: mock(() => Promise.resolve(mockConnection)),
}));

describe("introspection", () => {
  describe("introspectServer", () => {
    test("successfully introspects HTTP MCP server", async () => {
      const server: McpServerConfig = {
        type: "http",
        url: "http://localhost:3000",
      };

      const result = await introspectServer(server);

      expect(result.server).toEqual(server);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.capabilities).toEqual(mockCapabilities);
        expect(result.tools).toEqual(mockTools);
        expect(result.resources).toEqual(mockResources);
        expect(result.prompts).toEqual(mockPrompts);
      }

      // Verify connection was closed
      expect(mockConnection.client.close).toHaveBeenCalled();
    });

    test("handles connection failure gracefully", async () => {
      const errorMessage = "Connection refused";
      const createMcpConnectionMock = mcpClient.createMcpConnection as any;
      createMcpConnectionMock.mockRejectedValueOnce(new Error(errorMessage));

      const server: McpServerConfig = {
        type: "http",
        url: "http://localhost:9999",
      };

      const result = await introspectServer(server);

      expect(result.server).toEqual(server);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(errorMessage);
      }
    });

    test("handles SSE server type", async () => {
      const server: McpServerConfig = {
        type: "sse",
        url: "https://example.com/sse",
      };

      const result = await introspectServer(server);

      expect(result.server).toEqual(server);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.capabilities).toEqual(mockCapabilities);
        expect(result.tools).toEqual(mockTools);
      }
    });

    test("handles empty capabilities gracefully", async () => {
      const createMcpConnectionMock = mcpClient.createMcpConnection as any;
      createMcpConnectionMock.mockResolvedValueOnce({
        client: mockConnection.client,
        server: { type: "http", url: "http://localhost:3000" },
        capabilities: {},
        tools: [],
        resources: [],
        prompts: [],
      });

      const server: McpServerConfig = {
        type: "http",
        url: "http://localhost:3000",
      };

      const result = await introspectServer(server);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.capabilities).toEqual({});
        expect(result.tools).toEqual([]);
        expect(result.resources).toEqual([]);
        expect(result.prompts).toEqual([]);
      }
    });

    test("ignores errors when closing connection", async () => {
      const closeMock = mockConnection.client.close as any;
      closeMock.mockRejectedValueOnce(new Error("Close failed"));

      const server: McpServerConfig = {
        type: "http",
        url: "http://localhost:3000",
      };

      // Should not throw even if close fails
      const result = await introspectServer(server);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.tools).toEqual(mockTools);
      }
    });

    test("passes client config to connection", async () => {
      const createMcpConnectionMock = mcpClient.createMcpConnection as any;
      createMcpConnectionMock.mockClear();

      const server: McpServerConfig = {
        type: "http",
        url: "http://localhost:3000",
      };

      const config = {
        name: "test-client",
        version: "2.0.0",
        timeout: 5000,
      };

      await introspectServer(server, config);

      expect(createMcpConnectionMock).toHaveBeenCalledWith(server, config);
    });
  });

  describe("introspectServers", () => {
    test("introspects multiple servers in parallel", async () => {
      const servers: McpServerConfig[] = [
        { type: "http", url: "http://localhost:3000" },
        { type: "sse", url: "https://example.com/sse" },
        { type: "http", url: "http://localhost:4000" },
      ];

      const results = await introspectServers(servers);

      expect(results).toHaveLength(3);
      results.forEach((result, index) => {
        expect(result.server).toEqual(servers[index]!);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.tools).toEqual(mockTools);
        }
      });
    });

    test("handles mixed success and failure", async () => {
      const createMcpConnectionMock = mcpClient.createMcpConnection as any;
      createMcpConnectionMock
        .mockResolvedValueOnce(mockConnection) // Success
        .mockRejectedValueOnce(new Error("Connection failed")) // Failure
        .mockResolvedValueOnce(mockConnection); // Success

      const servers: McpServerConfig[] = [
        { type: "http", url: "http://localhost:3000" },
        { type: "http", url: "http://localhost:9999" },
        { type: "sse", url: "https://example.com/sse" },
      ];

      const results = await introspectServers(servers);

      expect(results).toHaveLength(3);
      expect(results[0]!.ok).toBe(true);
      expect(results[1]!.ok).toBe(false);
      if (!results[1]!.ok) {
        expect(results[1]!.error).toBe("Connection failed");
      }
      expect(results[2]!.ok).toBe(true);
    });

    test("preserves input order", async () => {
      const servers: McpServerConfig[] = [
        { type: "http", url: "http://server1.com" },
        { type: "sse", url: "http://server2.com" },
        { type: "http", url: "http://server3.com" },
      ];

      const results = await introspectServers(servers);

      expect(results[0]!.server.url).toBe("http://server1.com");
      expect(results[1]!.server.url).toBe("http://server2.com");
      expect(results[2]!.server.url).toBe("http://server3.com");
    });

    test("handles empty server array", async () => {
      const results = await introspectServers([]);
      expect(results).toEqual([]);
    });

    test("passes config to all servers", async () => {
      const createMcpConnectionMock = mcpClient.createMcpConnection as any;
      createMcpConnectionMock.mockClear();

      const servers: McpServerConfig[] = [
        { type: "http", url: "http://localhost:3000" },
        { type: "http", url: "http://localhost:4000" },
      ];

      const config = { timeout: 3000 };

      await introspectServers(servers, config);

      expect(createMcpConnectionMock).toHaveBeenCalledTimes(2);
      expect(createMcpConnectionMock).toHaveBeenCalledWith(servers[0], config);
      expect(createMcpConnectionMock).toHaveBeenCalledWith(servers[1], config);
    });
  });
});

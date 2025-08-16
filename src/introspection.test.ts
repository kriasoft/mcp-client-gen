/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  mock,
} from "bun:test";
import type { McpServer } from "./types.js";
import {
  introspectServer,
  introspectServersParallel,
  getCachedCapabilities,
  clearCapabilityCache,
} from "./introspection.js";
import * as mcpClient from "./mcp-client.js";

// Sample data for tests (defined before mockConnection)
const mockCapabilities = {
  tools: { listChanged: true },
  resources: { subscribe: true },
  prompts: {},
};

const mockTools = [
  {
    name: "create_file",
    description: "Create a new file",
    inputSchema: {
      type: "object" as const,
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
      type: "object" as const,
      properties: {
        path: { type: "string" },
      },
      required: ["path"],
    },
  },
];

const mockResources = [
  {
    uri: "file:///Users/test/project",
    name: "Project Directory",
    description: "Root project directory",
    mimeType: "text/directory",
  },
];

const mockPrompts = [
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
  beforeAll(() => {
    clearCapabilityCache();
  });

  afterAll(() => {
    clearCapabilityCache();
  });

  describe("introspectServer", () => {
    test("successfully introspects HTTP MCP server", async () => {
      const server: McpServer = {
        type: "http",
        url: "http://localhost:3000",
      };

      const result = await introspectServer(server);

      expect(result.server).toEqual(server);
      expect(result.capabilities).toEqual(mockCapabilities);
      expect(result.tools).toEqual(mockTools);
      expect(result.resources).toEqual(mockResources);
      expect(result.prompts).toEqual(mockPrompts);
      expect(result.error).toBeUndefined();

      // Verify connection was closed
      expect(mockConnection.client.close).toHaveBeenCalled();
    });

    test("handles connection failure gracefully", async () => {
      const errorMessage = "Connection refused";
      const createMcpConnectionMock = mcpClient.createMcpConnection as any;
      createMcpConnectionMock.mockRejectedValueOnce(new Error(errorMessage));

      const server: McpServer = {
        type: "http",
        url: "http://localhost:9999",
      };

      const result = await introspectServer(server);

      expect(result.server).toEqual(server);
      expect(result.error).toBe(errorMessage);
      expect(result.tools).toEqual([]);
      expect(result.resources).toEqual([]);
      expect(result.prompts).toEqual([]);
    });

    test("handles SSE server type", async () => {
      const server: McpServer = {
        type: "sse",
        url: "https://example.com/sse",
      };

      const result = await introspectServer(server);

      expect(result.server).toEqual(server);
      expect(result.capabilities).toEqual(mockCapabilities);
      expect(result.tools).toEqual(mockTools);
    });

    test("handles missing capabilities gracefully", async () => {
      const createMcpConnectionMock = mcpClient.createMcpConnection as any;
      createMcpConnectionMock.mockResolvedValueOnce({
        client: mockConnection.client,
        server: { type: "http", url: "http://localhost:3000" },
        capabilities: undefined,
        tools: undefined,
        resources: undefined,
        prompts: undefined,
      });

      const server: McpServer = {
        type: "http",
        url: "http://localhost:3000",
      };

      const result = await introspectServer(server);

      expect(result.capabilities).toBeUndefined();
      expect(result.tools).toEqual([]);
      expect(result.resources).toEqual([]);
      expect(result.prompts).toEqual([]);
      expect(result.error).toBeUndefined();
    });

    test("ignores errors when closing connection", async () => {
      const closeMock = mockConnection.client.close as any;
      closeMock.mockRejectedValueOnce(new Error("Close failed"));

      const server: McpServer = {
        type: "http",
        url: "http://localhost:3000",
      };

      // Should not throw even if close fails
      const result = await introspectServer(server);

      expect(result.error).toBeUndefined();
      expect(result.tools).toEqual(mockTools);
    });

    test("passes client config to connection", async () => {
      const createMcpConnectionMock = mcpClient.createMcpConnection as any;
      createMcpConnectionMock.mockClear();

      const server: McpServer = {
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

  describe("introspectServersParallel", () => {
    test("introspects multiple servers in parallel", async () => {
      const servers: McpServer[] = [
        { type: "http", url: "http://localhost:3000" },
        { type: "sse", url: "https://example.com/sse" },
        { type: "http", url: "http://localhost:4000" },
      ];

      const results = await introspectServersParallel(servers);

      expect(results).toHaveLength(3);
      results.forEach((result, index) => {
        expect(result.server).toEqual(servers[index]!);
        expect(result.tools).toEqual(mockTools);
        expect(result.error).toBeUndefined();
      });
    });

    test("handles mixed success and failure", async () => {
      const createMcpConnectionMock = mcpClient.createMcpConnection as any;
      createMcpConnectionMock
        .mockResolvedValueOnce(mockConnection) // Success
        .mockRejectedValueOnce(new Error("Connection failed")) // Failure
        .mockResolvedValueOnce(mockConnection); // Success

      const servers: McpServer[] = [
        { type: "http", url: "http://localhost:3000" },
        { type: "http", url: "http://localhost:9999" },
        { type: "sse", url: "https://example.com/sse" },
      ];

      const results = await introspectServersParallel(servers);

      expect(results).toHaveLength(3);
      expect(results[0]!.error).toBeUndefined();
      expect(results[1]!.error).toBe("Connection failed");
      expect(results[2]!.error).toBeUndefined();
    });

    test("preserves input order", async () => {
      const servers: McpServer[] = [
        { type: "http", url: "http://server1.com" },
        { type: "sse", url: "http://server2.com" },
        { type: "http", url: "http://server3.com" },
      ];

      const results = await introspectServersParallel(servers);

      expect(results[0]!.server.url).toBe("http://server1.com");
      expect(results[1]!.server.url).toBe("http://server2.com");
      expect(results[2]!.server.url).toBe("http://server3.com");
    });

    test("handles empty server array", async () => {
      const results = await introspectServersParallel([]);
      expect(results).toEqual([]);
    });

    test("passes config to all servers", async () => {
      const createMcpConnectionMock = mcpClient.createMcpConnection as any;
      createMcpConnectionMock.mockClear();

      const servers: McpServer[] = [
        { type: "http", url: "http://localhost:3000" },
        { type: "http", url: "http://localhost:4000" },
      ];

      const config = { timeout: 3000 };

      await introspectServersParallel(servers, config);

      expect(createMcpConnectionMock).toHaveBeenCalledTimes(2);
      expect(createMcpConnectionMock).toHaveBeenCalledWith(servers[0], config);
      expect(createMcpConnectionMock).toHaveBeenCalledWith(servers[1], config);
    });
  });

  describe("getCachedCapabilities", () => {
    beforeAll(() => {
      // Reset mock to default behavior
      const createMcpConnectionMock = mcpClient.createMcpConnection as any;
      createMcpConnectionMock.mockImplementation(() =>
        Promise.resolve(mockConnection),
      );
    });

    // Clear cache before each test to ensure isolation
    beforeEach(() => {
      clearCapabilityCache();
    });

    test("caches successful introspection results", async () => {
      const createMcpConnectionMock = mcpClient.createMcpConnection as any;
      createMcpConnectionMock.mockClear();

      const server: McpServer = {
        type: "http",
        url: "http://localhost:3000",
      };

      // First call - should introspect
      const result1 = await getCachedCapabilities(server);
      expect(result1.tools).toEqual(mockTools);
      expect(createMcpConnectionMock).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      const result2 = await getCachedCapabilities(server);
      expect(result2).toBe(result1); // Same object reference
      expect(createMcpConnectionMock).toHaveBeenCalledTimes(1); // Not called again
    });

    test("does not cache failed introspections", async () => {
      const createMcpConnectionMock = mcpClient.createMcpConnection as any;
      createMcpConnectionMock
        .mockRejectedValueOnce(new Error("Connection failed"))
        .mockResolvedValueOnce(mockConnection);

      const server: McpServer = {
        type: "http",
        url: "http://localhost:5000",
      };

      // First call - fails
      const result1 = await getCachedCapabilities(server);
      expect(result1.error).toBe("Connection failed");

      // Second call - should try again (not cached)
      const result2 = await getCachedCapabilities(server);
      expect(result2.error).toBeUndefined();
      expect(result2.tools).toEqual(mockTools);
    });

    test("forceRefresh bypasses cache", async () => {
      const createMcpConnectionMock = mcpClient.createMcpConnection as any;
      createMcpConnectionMock.mockClear();
      createMcpConnectionMock.mockImplementation(() =>
        Promise.resolve(mockConnection),
      );

      const server: McpServer = {
        type: "http",
        url: "http://localhost:3000",
      };

      // First call - populates cache
      await getCachedCapabilities(server);
      expect(createMcpConnectionMock).toHaveBeenCalledTimes(1);

      // Second call with forceRefresh - bypasses cache
      await getCachedCapabilities(server, undefined, true);
      expect(createMcpConnectionMock).toHaveBeenCalledTimes(2);
    });

    test("uses different cache keys for different servers", async () => {
      const createMcpConnectionMock = mcpClient.createMcpConnection as any;
      createMcpConnectionMock.mockClear();
      createMcpConnectionMock.mockImplementation(() =>
        Promise.resolve(mockConnection),
      );

      const server1: McpServer = {
        type: "http",
        url: "http://localhost:3000",
      };

      const server2: McpServer = {
        type: "sse",
        url: "http://localhost:3000", // Same URL, different type
      };

      const server3: McpServer = {
        type: "http",
        url: "http://localhost:4000", // Different URL, same type
      };

      await getCachedCapabilities(server1);
      await getCachedCapabilities(server2);
      await getCachedCapabilities(server3);

      // Should make 3 separate calls (different cache keys)
      expect(createMcpConnectionMock).toHaveBeenCalledTimes(3);

      // Subsequent calls should use cache
      await getCachedCapabilities(server1);
      await getCachedCapabilities(server2);
      await getCachedCapabilities(server3);

      // Still only 3 calls total
      expect(createMcpConnectionMock).toHaveBeenCalledTimes(3);
    });
  });

  describe("clearCapabilityCache", () => {
    test("clears all cached capabilities", async () => {
      // Clear cache first to ensure clean state
      clearCapabilityCache();

      const createMcpConnectionMock = mcpClient.createMcpConnection as any;
      createMcpConnectionMock.mockClear();
      createMcpConnectionMock.mockImplementation(() =>
        Promise.resolve(mockConnection),
      );

      const server: McpServer = {
        type: "http",
        url: "http://localhost:3000",
      };

      // Populate cache
      await getCachedCapabilities(server);
      expect(createMcpConnectionMock).toHaveBeenCalledTimes(1);

      // Clear cache
      clearCapabilityCache();

      // Should introspect again
      await getCachedCapabilities(server);
      expect(createMcpConnectionMock).toHaveBeenCalledTimes(2);
    });
  });
});

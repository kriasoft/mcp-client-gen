/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
// TODO: Import from mcp-client once ServerIntrospector is implemented
// import {
//   ServerIntrospector,
//   type McpTool,
//   type McpResponse,
//   type McpRequest,
//   type ServerConnection,
//   type IntrospectionResult,
// } from "./mcp-client";
import type { McpServer } from "./types";

// Mock server utilities
class MockMcpServer {
  public server: any;
  private port: number;
  private responses: Map<string, any> = new Map();

  constructor(port: number = 0) {
    this.port = port;
  }

  async start(): Promise<number> {
    const responses = this.responses;
    this.server = Bun.serve({
      port: this.port,
      async fetch(req: Request): Promise<Response> {
        const url = new URL(req.url);

        if (req.method === "POST") {
          try {
            const body = (await req.json()) as McpRequest;
            const responseKey = `${body.method}:${JSON.stringify(body.params || {})}`;

            const mockResponse =
              responses.get(responseKey) || responses.get(body.method);

            if (mockResponse) {
              return new Response(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: body.id,
                  ...mockResponse,
                }),
                {
                  headers: { "Content-Type": "application/json" },
                },
              );
            }
          } catch (error) {
            // Return JSON-RPC error for malformed requests
            return new Response(
              JSON.stringify({
                jsonrpc: "2.0",
                id: null,
                error: {
                  code: -32700,
                  message: "Parse error",
                },
              }),
              {
                status: 200,
                headers: { "Content-Type": "application/json" },
              },
            );
          }
        }

        return new Response("Method not allowed", { status: 405 });
      },
    });

    return this.server.port;
  }

  setResponse(method: string, response: any): void {
    this.responses.set(method, response);
  }

  setResponseWithParams(method: string, params: any, response: any): void {
    const key = `${method}:${JSON.stringify(params)}`;
    this.responses.set(key, response);
  }

  async stop(): Promise<void> {
    if (this.server) {
      this.server.stop();
    }
  }
}

// Test fixtures
const validServerInfo = {
  serverInfo: {
    name: "Test MCP Server",
    version: "1.0.0",
  },
  protocolVersion: "2024-11-05",
  capabilities: {
    tools: { listChanged: true },
    prompts: {},
    resources: { subscribe: true },
  },
};

const sampleTools: McpTool[] = [
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

// Test setup
let mockServer: MockMcpServer;
let mockServerUrl: string;
let introspector: ServerIntrospector;

beforeAll(async () => {
  mockServer = new MockMcpServer();
  const port = await mockServer.start();
  mockServerUrl = `http://localhost:${port}`;
  introspector = new ServerIntrospector();

  // Set up default successful responses
  mockServer.setResponse("initialize", { result: validServerInfo });
  mockServer.setResponse("tools/list", { result: { tools: sampleTools } });
});

afterAll(async () => {
  await introspector.disconnectAll();
  await mockServer.stop();
});

describe("introspection", () => {
  describe("ServerIntrospector", () => {
    describe("connect", () => {
      test("successfully connects to HTTP MCP server", async () => {
        const server: McpServer = {
          type: "http",
          url: mockServerUrl,
        };

        const connection = await introspector.connect(server);

        expect(connection.connected).toBe(true);
        expect(connection.server).toEqual(server);
        expect(connection.info.name).toBe("Test MCP Server");
        expect(connection.info.version).toBe("1.0.0");
        expect(connection.info.protocolVersion).toBe("2024-11-05");
        expect(connection.sessionId).toMatch(/^session-/);
      });

      test("reuses existing connection", async () => {
        const server: McpServer = {
          type: "http",
          url: mockServerUrl,
        };

        const connection1 = await introspector.connect(server);
        const connection2 = await introspector.connect(server);

        expect(connection1).toBe(connection2);
        expect(connection1.sessionId).toBe(connection2.sessionId);
      });

      test("throws error for unsupported transport type", async () => {
        const server: McpServer = {
          type: "websocket" as any,
          url: "ws://localhost:8080",
        };

        await expect(introspector.connect(server)).rejects.toThrow(
          "Unsupported server type: websocket",
        );
      });

      test("handles server initialization error", async () => {
        const errorServer = new MockMcpServer();
        const errorPort = await errorServer.start();
        errorServer.setResponse("initialize", {
          error: {
            code: -1,
            message: "Server initialization failed",
          },
        });

        const server: McpServer = {
          type: "http",
          url: `http://localhost:${errorPort}`,
        };

        await expect(introspector.connect(server)).rejects.toThrow(
          "Server initialization failed: Server initialization failed",
        );

        await errorServer.stop();
      });

      test("handles HTTP connection failure", async () => {
        const server: McpServer = {
          type: "http",
          url: "http://localhost:99999",
        };

        await expect(introspector.connect(server)).rejects.toThrow(
          /Failed to connect to MCP server at http:\/\/localhost:99999/,
        );
      });

      test("handles malformed server response", async () => {
        const malformedServer = new MockMcpServer();
        const malformedPort = await malformedServer.start();

        // Override the server to return invalid JSON
        malformedServer.server?.stop();
        malformedServer.server = Bun.serve({
          port: malformedPort,
          async fetch(): Promise<Response> {
            return new Response("invalid json", {
              headers: { "Content-Type": "application/json" },
            });
          },
        });

        const server: McpServer = {
          type: "http",
          url: `http://localhost:${malformedPort}`,
        };

        await expect(introspector.connect(server)).rejects.toThrow(
          /Failed to connect to MCP server/,
        );

        await malformedServer.stop();
      });
    });

    describe("listTools", () => {
      let connection: ServerConnection;

      beforeAll(async () => {
        const server: McpServer = {
          type: "http",
          url: mockServerUrl,
        };
        connection = await introspector.connect(server);
      });

      test("successfully lists tools", async () => {
        const tools = await introspector.listTools(connection);

        expect(tools).toHaveLength(2);
        expect(tools[0]!.name).toBe("create_file");
        expect(tools[0]!.description).toBe("Create a new file");
        expect(tools[0]!.inputSchema.type).toBe("object");
        expect(tools[1]!.name).toBe("read_file");
      });

      test("handles empty tools list", async () => {
        const emptyServer = new MockMcpServer();
        const emptyPort = await emptyServer.start();
        emptyServer.setResponse("initialize", { result: validServerInfo });
        emptyServer.setResponse("tools/list", { result: { tools: [] } });

        const server: McpServer = {
          type: "http",
          url: `http://localhost:${emptyPort}`,
        };

        const emptyConnection = await introspector.connect(server);
        const tools = await introspector.listTools(emptyConnection);

        expect(tools).toEqual([]);
        await emptyServer.stop();
      });

      test("handles tools/list error", async () => {
        const errorConnection = { ...connection };

        // Temporarily override response for this test
        mockServer.setResponse("tools/list", {
          error: {
            code: -1,
            message: "Failed to list tools",
          },
        });

        await expect(introspector.listTools(errorConnection)).rejects.toThrow(
          "Failed to list tools: Failed to list tools",
        );

        // Restore normal response
        mockServer.setResponse("tools/list", {
          result: { tools: sampleTools },
        });
      });

      test("throws error for disconnected connection", async () => {
        const disconnectedConnection: ServerConnection = {
          ...connection,
          connected: false,
        };

        await expect(
          introspector.listTools(disconnectedConnection),
        ).rejects.toThrow("Connection is not established");
      });
    });

    describe("getToolSchema", () => {
      let connection: ServerConnection;

      beforeAll(async () => {
        const server: McpServer = {
          type: "http",
          url: mockServerUrl,
        };
        connection = await introspector.connect(server);
      });

      test("throws not implemented error", async () => {
        await expect(
          introspector.getToolSchema(connection, "create_file"),
        ).rejects.toThrow("getToolSchema not yet implemented");
      });

      test("throws error for disconnected connection", async () => {
        const disconnectedConnection: ServerConnection = {
          ...connection,
          connected: false,
        };

        await expect(
          introspector.getToolSchema(disconnectedConnection, "test"),
        ).rejects.toThrow("Connection is not established");
      });
    });

    describe("introspectServer", () => {
      test("successfully introspects server", async () => {
        const server: McpServer = {
          type: "http",
          url: mockServerUrl,
        };

        const result: IntrospectionResult =
          await introspector.introspectServer(server);

        expect(result.connection.connected).toBe(true);
        expect(result.connection.info.name).toBe("Test MCP Server");
        expect(result.tools).toHaveLength(2);
        expect(result.schemas.size).toBe(2);
        expect(result.schemas.has("create_file")).toBe(true);
        expect(result.schemas.has("read_file")).toBe(true);
      });

      test("handles tools without schemas", async () => {
        const schemalessServer = new MockMcpServer();
        const schemalessPort = await schemalessServer.start();
        schemalessServer.setResponse("initialize", { result: validServerInfo });
        schemalessServer.setResponse("tools/list", {
          result: {
            tools: [
              {
                name: "tool_without_schema",
                description: "A tool without schema",
              },
            ],
          },
        });

        const server: McpServer = {
          type: "http",
          url: `http://localhost:${schemalessPort}`,
        };

        const result = await introspector.introspectServer(server);

        expect(result.tools).toHaveLength(1);
        expect(result.schemas.size).toBe(0);
        await schemalessServer.stop();
      });
    });

    describe("disconnect", () => {
      test("successfully disconnects from server", async () => {
        const server: McpServer = {
          type: "http",
          url: mockServerUrl,
        };

        const connection = await introspector.connect(server);
        expect(connection.connected).toBe(true);

        await introspector.disconnect(connection);
        expect(connection.connected).toBe(false);
      });

      test("handles already disconnected connection", async () => {
        const server: McpServer = {
          type: "http",
          url: mockServerUrl,
        };

        const connection = await introspector.connect(server);
        await introspector.disconnect(connection);

        // Second disconnect should not throw
        await expect(
          introspector.disconnect(connection),
        ).resolves.toBeUndefined();
      });

      test("ignores errors during disconnect", async () => {
        const flakyServer = new MockMcpServer();
        const flakyPort = await flakyServer.start();
        flakyServer.setResponse("initialize", { result: validServerInfo });

        const server: McpServer = {
          type: "http",
          url: `http://localhost:${flakyPort}`,
        };

        const connection = await introspector.connect(server);

        // Stop server to simulate disconnect error
        await flakyServer.stop();

        // Disconnect should still succeed despite server being down
        await expect(
          introspector.disconnect(connection),
        ).resolves.toBeUndefined();
        expect(connection.connected).toBe(false);
      });
    });

    describe("disconnectAll", () => {
      test("disconnects all connections", async () => {
        // Create a second mock server for testing multiple connections
        const secondMockServer = new MockMcpServer();
        const secondPort = await secondMockServer.start();
        secondMockServer.setResponse("initialize", { result: validServerInfo });
        secondMockServer.setResponse("tools/list", {
          result: { tools: sampleTools },
        });

        const server1: McpServer = { type: "http", url: mockServerUrl };
        const server2: McpServer = {
          type: "http",
          url: `http://localhost:${secondPort}`,
        };

        const connection1 = await introspector.connect(server1);

        // Create second connection with different key
        const freshIntrospector = new ServerIntrospector();

        const connection2 = await freshIntrospector.connect(server2);

        expect(connection1.connected).toBe(true);
        expect(connection2.connected).toBe(true);

        await introspector.disconnectAll();
        await freshIntrospector.disconnectAll();

        expect(connection1.connected).toBe(false);
        expect(connection2.connected).toBe(false);

        await secondMockServer.stop();
      });

      test("handles mixed success/failure scenarios", async () => {
        const workingServer = new MockMcpServer();
        const workingPort = await workingServer.start();
        workingServer.setResponse("initialize", { result: validServerInfo });

        const brokenServer = new MockMcpServer();
        const brokenPort = await brokenServer.start();
        brokenServer.setResponse("initialize", { result: validServerInfo });

        const testIntrospector = new ServerIntrospector();

        const server1: McpServer = {
          type: "http",
          url: `http://localhost:${workingPort}`,
        };
        const server2: McpServer = {
          type: "http",
          url: `http://localhost:${brokenPort}`,
        };

        const connection1 = await testIntrospector.connect(server1);
        const connection2 = await testIntrospector.connect(server2);

        // Break one server
        await brokenServer.stop();

        // disconnectAll should succeed despite one server being down
        await expect(testIntrospector.disconnectAll()).resolves.toBeUndefined();

        expect(connection1.connected).toBe(false);
        expect(connection2.connected).toBe(false);

        await workingServer.stop();
      });
    });

    describe("SSE transport", () => {
      test("throws not implemented error for SSE requests", async () => {
        const server: McpServer = {
          type: "sse",
          url: "https://example.com/sse",
        };

        await expect(introspector.connect(server)).rejects.toThrow(
          "SSE transport not yet implemented",
        );
      });
    });

    describe("HTTP error responses", () => {
      test.each([
        [404, "HTTP 404: Not Found"],
        [500, "HTTP 500: Internal Server Error"],
        [503, "HTTP 503: Service Unavailable"],
      ])("handles HTTP %d error", async (status, expectedMessage) => {
        const errorServer = new MockMcpServer();
        const errorPort = await errorServer.start();

        // Override server to return HTTP error
        errorServer.server?.stop();
        errorServer.server = Bun.serve({
          port: errorPort,
          async fetch(): Promise<Response> {
            return new Response("Error", { status });
          },
        });

        const server: McpServer = {
          type: "http",
          url: `http://localhost:${errorPort}`,
        };

        await expect(introspector.connect(server)).rejects.toThrow(
          expectedMessage,
        );
        await errorServer.stop();
      });
    });

    describe("JSON-RPC protocol compliance", () => {
      test("sends correct initialize request format", async () => {
        let capturedRequest: McpRequest | null = null;

        const protocolServer = new MockMcpServer();
        const protocolPort = await protocolServer.start();

        protocolServer.server?.stop();
        protocolServer.server = Bun.serve({
          port: protocolPort,
          async fetch(req: Request): Promise<Response> {
            if (req.method === "POST") {
              capturedRequest = (await req.json()) as McpRequest;
              return new Response(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: capturedRequest.id,
                  result: validServerInfo,
                }),
              );
            }
            return new Response("Method not allowed", { status: 405 });
          },
        });

        const server: McpServer = {
          type: "http",
          url: `http://localhost:${protocolPort}`,
        };

        await introspector.connect(server);

        expect(capturedRequest).toBeTruthy();
        expect(capturedRequest!.jsonrpc).toBe("2.0");
        expect(capturedRequest!.method).toBe("initialize");
        expect(capturedRequest!.id).toBeDefined();
        expect(capturedRequest!.params).toEqual({
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: {},
            prompts: {},
            resources: {},
          },
          clientInfo: {
            name: "mcp-client-gen",
            version: "1.0.0",
          },
        });

        await protocolServer.stop();
      });

      test("handles missing result in response", async () => {
        const incompleteServer = new MockMcpServer();
        const incompletePort = await incompleteServer.start();
        incompleteServer.setResponse("initialize", { result: {} });

        const server: McpServer = {
          type: "http",
          url: `http://localhost:${incompletePort}`,
        };

        const connection = await introspector.connect(server);

        expect(connection.info.name).toBe("Unknown Server");
        expect(connection.info.version).toBe("unknown");
        expect(connection.info.protocolVersion).toBe("2024-11-05");

        await incompleteServer.stop();
      });
    });

    describe("concurrent operations", () => {
      test("handles multiple simultaneous connections", async () => {
        const servers: McpServer[] = [];
        const mockServers: MockMcpServer[] = [];

        // Create multiple mock servers
        for (let i = 0; i < 3; i++) {
          const server = new MockMcpServer();
          const port = await server.start();
          server.setResponse("initialize", { result: validServerInfo });
          mockServers.push(server);
          servers.push({ type: "http", url: `http://localhost:${port}` });
        }

        const testIntrospector = new ServerIntrospector();

        // Connect to all servers simultaneously
        const connections = await Promise.all(
          servers.map((server) => testIntrospector.connect(server)),
        );

        expect(connections).toHaveLength(3);
        connections.forEach((connection) => {
          expect(connection.connected).toBe(true);
        });

        await testIntrospector.disconnectAll();

        for (const mockServer of mockServers) {
          await mockServer.stop();
        }
      });

      test("handles concurrent tool listing requests", async () => {
        const server: McpServer = {
          type: "http",
          url: mockServerUrl,
        };

        const connection = await introspector.connect(server);

        // Make multiple concurrent requests
        const toolPromises = [
          introspector.listTools(connection),
          introspector.listTools(connection),
          introspector.listTools(connection),
        ];

        const results = await Promise.all(toolPromises);

        results.forEach((tools) => {
          expect(tools).toHaveLength(2);
          expect(tools[0]!.name).toBe("create_file");
        });
      });
    });
  });
});

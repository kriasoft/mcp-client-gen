/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * createMcpConnection() against the real MCP SDK server, so client/server protocol drift
 * can't hide behind a mock. OAuth itself is covered by oauth-callback's own suite.
 */

import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { CredentialStore } from "oauth-callback/mcp";
import { createMcpConnection, type McpConnection } from "./mcp-client.js";
import type { McpServerConfig } from "./types.js";

let fixture: ReturnType<typeof startFixture>;
const connections: McpConnection[] = [];

beforeEach(() => {
  fixture = startFixture();
});

afterEach(async () => {
  await Promise.all(connections.splice(0).map((c) => c.client.close()));
  await fixture.server.stop(true);
});

/** Unauthenticated MCP server with one tool, resource and prompt; records request headers. */
function startFixture() {
  const headers: Headers[] = [];
  const mcp = createMcpHandler(() => {
    const server = new McpServer({ name: "fixture", version: "1.0.0" });
    server.registerTool("echo", { description: "Echo" }, async () => ({
      content: [{ type: "text", text: "ok" }],
    }));
    server.registerResource(
      "readme",
      "file:///readme.md",
      { mimeType: "text/markdown" },
      async (uri) => ({ contents: [{ uri: uri.href, text: "# Hi" }] }),
    );
    server.registerPrompt("greet", { description: "Greet" }, async () => ({
      messages: [{ role: "user", content: { type: "text", text: "Hi" } }],
    }));
    return server;
  });
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      headers.push(request.headers);
      return mcp.fetch(request);
    },
  });
  return { server, headers, url: new URL("/mcp", server.url).href };
}

const connect = async (...args: Parameters<typeof createMcpConnection>) => {
  const connection = await createMcpConnection(...args);
  connections.push(connection);
  return connection;
};

describe("createMcpConnection", () => {
  test("connects over Streamable HTTP and lists capabilities", async () => {
    const connection = await connect({ type: "http", url: fixture.url });

    expect(connection.tools.map((t) => t.name)).toEqual(["echo"]);
    expect(connection.resources.map((r) => r.uri)).toEqual([
      "file:///readme.md",
    ]);
    expect(connection.prompts.map((p) => p.name)).toEqual(["greet"]);
    expect(connection.capabilities.tools).toBeDefined();
  });

  test("sends server headers through the custom fetch", async () => {
    const fetch = mock(globalThis.fetch);

    await connect(
      { type: "http", url: fixture.url, headers: { "X-Api-Key": "secret" } },
      { fetch: fetch as unknown as typeof globalThis.fetch },
    );

    expect(fetch).toHaveBeenCalled();
    expect(fixture.headers.length).toBeGreaterThan(0);
    for (const h of fixture.headers) expect(h.get("x-api-key")).toBe("secret");
  });

  test("creates a credential store per server", async () => {
    const store = mock((_server: McpServerConfig): CredentialStore => ({
      load: async () => undefined,
      save: async () => {},
    }));
    const server: McpServerConfig = { type: "http", url: fixture.url };

    await connect(server, { oauth: { store } });

    expect(store).toHaveBeenCalledTimes(1);
    expect(store).toHaveBeenCalledWith(server);
  });

  test("accepts a pre-registered client without a client name", async () => {
    // clientName and clientInformation are exclusive in browserAuth()
    const connection = await connect(
      { type: "http", url: fixture.url },
      {
        oauth: {
          clientInformation: { client_id: "id", issuer: "https://as.test" },
        },
      },
    );

    expect(connection.tools).toHaveLength(1);
  });

  test("merges SSE server headers with Headers-instance request headers", async () => {
    const seen: Headers[] = [];
    const fetch = (async (
      _url: URL | string,
      init?: RequestInit,
    ): Promise<Response> => {
      seen.push(new Headers(init?.headers));
      throw new Error("stop");
    }) as typeof globalThis.fetch;

    await expect(
      createMcpConnection(
        { type: "sse", url: fixture.url, headers: { "X-Api-Key": "secret" } },
        { fetch },
      ),
    ).rejects.toThrow();

    expect(seen[0]?.get("x-api-key")).toBe("secret");
    expect(seen[0]?.get("accept")).toBe("text/event-stream");
  });

  test("connects to a private-network http: server without OAuth", async () => {
    // browserAuth() rejects non-loopback http:; route the host to the fixture instead
    const fetch = ((url: URL | string, init?: RequestInit) =>
      globalThis.fetch(
        String(url).replace("http://mcp.internal", fixture.server.url.origin),
        init,
      )) as typeof globalThis.fetch;

    const connection = await connect(
      { type: "http", url: "http://mcp.internal/mcp" },
      { fetch },
    );

    expect(connection.tools.map((t) => t.name)).toEqual(["echo"]);
  });

  test("times out an SSE request that never responds, then stops retrying", async () => {
    // Never responds; gives up after 2s itself so a missing timeout fails instead of hanging
    let calls = 0;
    const fetch = ((_url: URL | string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        calls++;
        const giveUp = setTimeout(() => reject(new Error("unbounded")), 2000);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(giveUp);
          reject(init.signal?.reason);
        });
      })) as typeof globalThis.fetch;

    const error = await createMcpConnection(
      { type: "sse", url: fixture.url },
      { fetch, timeout: 50 },
    ).catch((e: unknown) => e);

    expect(String(error)).toContain("Request timed out");

    // EventSource reconnects after ~3s unless the failed transport was closed
    const callsAtFailure = calls;
    await Bun.sleep(3500);
    expect(calls).toBe(callsAtFailure);
  }, 10_000);

  test("rejects unsupported server types", async () => {
    await expect(
      createMcpConnection({ type: "stdio", url: "" } as never),
    ).rejects.toThrow("Unsupported server type: stdio");
  });
});

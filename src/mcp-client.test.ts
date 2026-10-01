/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * createMcpConnection() against the real MCP SDK server, so client/server protocol drift
 * can't hide behind a mock. OAuth itself is covered by oauth-callback's own suite.
 */

import { UnauthorizedError } from "@modelcontextprotocol/client";
import {
  createMcpHandler,
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { CredentialStore } from "oauth-callback/mcp";
import { createMcpConnection, type McpConnection } from "./mcp-client.js";
import { createServer } from "node:net";
import { startLegacySseServer } from "../test/utils/legacy-sse-server.js";
import { startMockServer } from "../test/utils/mock-oauth-mcp-server.js";
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
    server.registerResource(
      "issue",
      new ResourceTemplate("repo://{owner}/issues/{id}", { list: undefined }),
      {},
      async (uri) => ({ contents: [{ uri: uri.href, text: "issue" }] }),
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
    expect(connection.resourceTemplates.map((t) => t.uriTemplate)).toEqual([
      "repo://{owner}/issues/{id}",
    ]);
    expect(connection.prompts.map((p) => p.name)).toEqual(["greet"]);
    expect(connection.capabilities.tools).toBeDefined();
  });

  test("treats a missing resources/templates/list as no templates", async () => {
    const fetch = (async (url: URL | string, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      if (body.method !== "resources/templates/list")
        return globalThis.fetch(url, init);
      const error = { code: -32601, message: "Method not found" };
      return Response.json({ jsonrpc: "2.0", id: body.id, error });
    }) as typeof globalThis.fetch;

    const connection = await connect(
      { type: "http", url: fixture.url },
      { fetch },
    );

    expect(connection.resourceTemplates).toEqual([]);
    expect(connection.resources).toHaveLength(1);
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

  test("reads credentials from the given store", async () => {
    const load = mock(async () => undefined);
    const store: CredentialStore = { load, save: async () => {} };

    const connection = await connect(
      { type: "http", url: fixture.url },
      { oauth: { store } },
    );

    expect(load).toHaveBeenCalled();
    expect(connection.authorized).toBe(false); // the server never asked
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

  test("connects over legacy SSE with server headers on every request", async () => {
    const sse = startLegacySseServer();
    try {
      const connection = await connect(
        {
          type: "sse",
          url: sse.url,
          // Content-Type conflicts with the SDK's JSON POSTs: request headers must win
          headers: { "X-Api-Key": "secret", "Content-Type": "text/plain" },
        },
        { timeout: 100 },
      );

      expect(connection.tools.map((t) => t.name)).toEqual(["echo"]);
      // The request timeout stops at an event stream's headers: the stream outlives it
      await Bun.sleep(300);
      expect((await connection.client.listTools()).tools).toHaveLength(1);
      const get = sse.requests.filter((r) => r.method === "GET");
      const posts = sse.requests.filter((r) => r.method === "POST");
      expect(get).toHaveLength(1);
      expect(posts.length).toBeGreaterThan(0);
      for (const { headers } of sse.requests)
        expect(headers.get("x-api-key")).toBe("secret");
      expect(get[0]?.headers.get("accept")).toBe("text/event-stream");
      for (const { headers } of posts)
        expect(headers.get("content-type")).toBe("application/json");
    } finally {
      await sse.close();
    }
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

  test("times out an SSE request whose finite body stalls", async () => {
    // Headers arrive, the JSON body never ends (e.g. a stalled token endpoint); like real
    // fetch, aborting the request errors the body
    const fetch = (async (_url: URL | string, init?: RequestInit) => {
      const body = new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener("abort", () =>
            controller.error(init.signal?.reason),
          );
        },
      });
      return new Response(body, {
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    const error = await createMcpConnection(
      { type: "sse", url: fixture.url },
      { fetch, timeout: 50 },
    ).catch((e: unknown) => e);

    expect(String(error)).toContain("Request timed out");
  });

  test("rejects unsupported server types", async () => {
    await expect(
      createMcpConnection({ type: "stdio", url: "" } as never),
    ).rejects.toThrow("Unsupported server type: stdio");
  });
});

describe("createMcpConnection OAuth", () => {
  let oauth: Awaited<ReturnType<typeof startMockServer>>;

  beforeEach(async () => {
    oauth = await startMockServer();
  });

  afterEach(() => oauth.close());

  /** A loopback port that was free a moment ago (redirect URIs can't use port 0). */
  const freePort = () =>
    new Promise<number>((resolve) => {
      const server = createServer().listen(0, "127.0.0.1", () => {
        const { port } = server.address() as { port: number };
        server.close(() => resolve(port));
      });
    });

  /** OAuth config whose "browser" approves at once via the mock authorization server. */
  const oauthConfig = async () => ({
    oauth: {
      redirectUri: `http://127.0.0.1:${await freePort()}/callback`,
      launch: (url: URL) => void oauth.authorize(url),
      timeout: 5000,
    },
  });

  test("completes a step-up demanded while listing capabilities", async () => {
    // Initialize passes with the first grant; tools/list then demands the "admin" scope
    const fetch = ((url: URL | string, init?: RequestInit) => {
      if (typeof init?.body === "string" && init.body.includes('"tools/list"'))
        oauth.knobs.requiredScope = "admin";
      return globalThis.fetch(url, init);
    }) as typeof globalThis.fetch;

    const connection = await connect(
      { type: "http", url: oauth.mcpUrl },
      { ...(await oauthConfig()), fetch },
    );

    expect(connection.tools).toEqual([]);
    expect(connection.authorized).toBe(true);
    expect(oauth.authorizeRequests).toHaveLength(2);
    expect(oauth.authorizeRequests.at(-1)?.searchParams.get("scope")).toContain(
      "admin",
    );
  });

  test("completes every step-up it triggers, then gives up", async () => {
    // Each tools/list demands a scope the previous grant lacks
    let listings = 0;
    const fetch = ((url: URL | string, init?: RequestInit) => {
      if (typeof init?.body === "string" && init.body.includes('"tools/list"'))
        oauth.knobs.requiredScope = `scope-${++listings}`;
      return globalThis.fetch(url, init);
    }) as typeof globalThis.fetch;
    const config = { ...(await oauthConfig()), fetch };
    const port = new URL(config.oauth.redirectUri).port;

    await expect(
      createMcpConnection({ type: "http", url: oauth.mcpUrl }, config),
    ).rejects.toBeInstanceOf(UnauthorizedError);

    expect(oauth.authorizeRequests).toHaveLength(4); // initial + 3 step-ups
    // Every flow completed: its callback listener released the port
    const listener = Bun.listen({
      hostname: "127.0.0.1",
      port: Number(port),
      socket: { data() {} },
    });
    listener.stop(true);
  });
});

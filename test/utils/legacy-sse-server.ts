/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * Minimal legacy HTTP+SSE MCP server (the SDK v2 server package no longer ships one):
 * GET /sse announces a POST endpoint, and JSON-RPC responses return over the stream.
 * Answers initialize and tools/list with one "echo" tool; records every request's headers.
 */

export function startLegacySseServer() {
  const requests: { method: string; headers: Headers }[] = [];
  const encoder = new TextEncoder();
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
  const send = (event: string, data: string) =>
    stream?.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0, // keep the event stream open
    async fetch(request) {
      requests.push({ method: request.method, headers: request.headers });
      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === "/sse") {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            stream = controller;
            send("endpoint", "/messages");
          },
        });
        return new Response(body, {
          headers: { "Content-Type": "text/event-stream" },
        });
      }

      if (request.method === "POST" && url.pathname === "/messages") {
        const message = (await request.json()) as {
          id?: number;
          method: string;
          params?: { protocolVersion?: string };
        };
        if ("id" in message) {
          const result =
            message.method === "initialize"
              ? {
                  protocolVersion: message.params?.protocolVersion,
                  capabilities: { tools: {} },
                  serverInfo: { name: "legacy-sse", version: "1.0.0" },
                }
              : message.method === "tools/list"
                ? { tools: [{ name: "echo", inputSchema: { type: "object" } }] }
                : undefined;
          send(
            "message",
            JSON.stringify(
              result
                ? { jsonrpc: "2.0", id: message.id, result }
                : {
                    jsonrpc: "2.0",
                    id: message.id,
                    error: { code: -32601, message: "Method not found" },
                  },
            ),
          );
        }
        return new Response(null, { status: 202 });
      }

      return new Response("Not found", { status: 404 });
    },
  });

  return {
    url: new URL("/sse", server.url).href,
    requests,
    close: () => server.stop(true),
  };
}

/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * Mock MCP server + OAuth authorization server (discovery, DCR, PKCE, refresh) for e2e tests
 * against the real MCP SDK. `authorize()` plays the user approving in the browser.
 * Copied from oauth-callback's test/mock-mcp-server.ts.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

export interface MockOptions {
  /** Protected-resource metadata `scopes_supported`. */
  resourceScopes?: string[];
  /** Authorization-server metadata `scopes_supported`. */
  serverScopes?: string[];
  /** Advertise RFC 9207 `iss` support. */
  issSupported?: boolean;
}

interface Code {
  clientId: string;
  redirectUri: string;
  challenge: string;
  scope?: string;
}

export async function startMockServer(options: MockOptions = {}) {
  const registrations: Record<string, unknown>[] = [];
  const authorizeRequests: URL[] = [];
  const tokenRequests: URLSearchParams[] = [];
  const codes = new Map<string, Code>();
  const accessTokens = new Map<string, { scope?: string }>();
  const refreshTokens = new Map<string, { clientId: string; scope?: string }>();
  const knobs = {
    /** Scope the MCP endpoint requires (403 insufficient_scope otherwise). */
    requiredScope: undefined as string | undefined,
    /** Delay token responses (ms), e.g. to test cancellation. */
    tokenDelay: 0,
    /** Refresh responses wait for this gate, so a test can decide when they'd land. */
    refreshGate: undefined as Promise<void> | undefined,
    /** Authorization-code responses wait for this gate. */
    exchangeGate: undefined as Promise<void> | undefined,
    /** Answer the next MCP request with 401, whatever its token. */
    rejectNext: false,
    /** Delay registration responses (ms). */
    registerDelay: 0,
    /** Next token response is this OAuth error. */
    tokenError: undefined as string | undefined,
  };

  let base = "";
  const json = (
    res: ServerResponse,
    status: number,
    body: unknown,
    headers = {},
  ) => {
    res.writeHead(status, { "Content-Type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  };
  const readBody = async (req: IncomingMessage) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    return body;
  };
  const issue = (clientId: string, scope?: string) => {
    const access_token = `at-${randomUUID()}`;
    const refresh_token = `rt-${randomUUID()}`;
    accessTokens.set(access_token, { scope });
    refreshTokens.set(refresh_token, { clientId, scope });
    return {
      access_token,
      refresh_token,
      token_type: "Bearer",
      expires_in: 3600,
      scope,
    };
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, base);
    const path = url.pathname;

    if (path.startsWith("/.well-known/oauth-protected-resource"))
      return json(res, 200, {
        resource: `${base}/mcp`,
        authorization_servers: [base],
        scopes_supported: options.resourceScopes,
      });
    if (path === "/.well-known/oauth-authorization-server")
      return json(res, 200, {
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: [
          "none",
          "client_secret_post",
          "client_secret_basic",
        ],
        scopes_supported: options.serverScopes,
        authorization_response_iss_parameter_supported:
          options.issSupported ?? true,
      });
    if (path === "/register" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      registrations.push(body);
      if (knobs.registerDelay)
        await new Promise((r) => setTimeout(r, knobs.registerDelay));
      if (res.destroyed) return;
      return json(res, 201, {
        ...body,
        client_id: `client-${registrations.length}`,
      });
    }
    if (path === "/token" && req.method === "POST") {
      const params = new URLSearchParams(await readBody(req));
      tokenRequests.push(params);
      if (knobs.tokenDelay)
        await new Promise((r) => setTimeout(r, knobs.tokenDelay));
      if (res.destroyed) return;
      if (knobs.tokenError) {
        const error = knobs.tokenError;
        knobs.tokenError = undefined;
        return json(res, 400, { error });
      }
      if (params.get("grant_type") === "authorization_code") {
        await knobs.exchangeGate;
        if (res.destroyed) return;
        const code = codes.get(params.get("code")!);
        codes.delete(params.get("code")!);
        const challenge = createHash("sha256")
          .update(params.get("code_verifier") ?? "")
          .digest("base64url");
        if (
          !code ||
          code.clientId !== params.get("client_id") ||
          code.challenge !== challenge ||
          code.redirectUri !== params.get("redirect_uri")
        )
          return json(res, 400, { error: "invalid_grant" });
        return json(res, 200, issue(code.clientId, code.scope));
      }
      if (params.get("grant_type") === "refresh_token") {
        await knobs.refreshGate;
        if (res.destroyed) return;
        const grant = refreshTokens.get(params.get("refresh_token")!);
        if (!grant || grant.clientId !== params.get("client_id"))
          return json(res, 400, { error: "invalid_grant" });
        return json(res, 200, issue(grant.clientId, grant.scope));
      }
      return json(res, 400, { error: "unsupported_grant_type" });
    }
    if (path === "/mcp") {
      const token = req.headers.authorization?.replace(/^Bearer /, "");
      const rejected = knobs.rejectNext;
      knobs.rejectNext = false;
      const grant = token && !rejected ? accessTokens.get(token) : undefined;
      const metadata = `${base}/.well-known/oauth-protected-resource/mcp`;
      if (!grant)
        return json(
          res,
          401,
          { error: "unauthorized" },
          {
            "WWW-Authenticate": `Bearer resource_metadata="${metadata}"`,
          },
        );
      if (
        knobs.requiredScope &&
        !grant.scope?.split(" ").includes(knobs.requiredScope)
      )
        return json(
          res,
          403,
          { error: "insufficient_scope" },
          {
            "WWW-Authenticate": `Bearer error="insufficient_scope", scope="${knobs.requiredScope}", resource_metadata="${metadata}"`,
          },
        );
      if (req.method !== "POST") return json(res, 405, {});
      const message = JSON.parse(await readBody(req));
      if (!("id" in message)) {
        res.writeHead(202).end();
        return;
      }
      const result =
        message.method === "initialize"
          ? {
              protocolVersion: message.params.protocolVersion,
              capabilities: { tools: {} },
              serverInfo: { name: "mock", version: "1.0.0" },
            }
          : message.method === "tools/list"
            ? { tools: [] }
            : undefined;
      if (!result)
        return json(res, 200, {
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32601, message: "Method not found" },
        });
      return json(res, 200, { jsonrpc: "2.0", id: message.id, result });
    }
    json(res, 404, {});
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  return {
    base,
    mcpUrl: `${base}/mcp`,
    registrations,
    authorizeRequests,
    tokenRequests,
    knobs,
    /** Rejects every access token issued so far, as if they had expired. */
    expireAccessTokens: () => accessTokens.clear(),
    /** Plays the user approving (or denying) in the browser: redirects to the callback. */
    async authorize(url: URL, overrides: Record<string, string> = {}) {
      authorizeRequests.push(url);
      const params = url.searchParams;
      const code = randomUUID();
      codes.set(code, {
        clientId: params.get("client_id")!,
        redirectUri: params.get("redirect_uri")!,
        challenge: params.get("code_challenge")!,
        scope: params.get("scope") ?? undefined,
      });
      const target = new URL(params.get("redirect_uri")!);
      target.searchParams.set("code", code);
      target.searchParams.set("state", params.get("state")!);
      target.searchParams.set("iss", base);
      for (const [key, value] of Object.entries(overrides)) {
        if (key === "code" && value === "") target.searchParams.delete("code");
        else target.searchParams.set(key, value);
      }
      return fetch(target);
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export type MockServer = Awaited<ReturnType<typeof startMockServer>>;

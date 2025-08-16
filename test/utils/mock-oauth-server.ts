/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import type {
  OAuthProtectedResourceMetadata,
  AuthorizationServerMetadata,
  OAuthClientInformationFull,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

export interface MockOAuthServerConfig {
  /** Mock server endpoint base */
  baseUrl: string;
  /** Enforce client_secret in token requests */
  requireClientAuth?: boolean;
  /** Override default AS metadata */
  metadata?: Partial<AuthorizationServerMetadata>;
  /** Override resource server metadata */
  resourceMetadata?: Partial<OAuthProtectedResourceMetadata>;
  /** Token expiry in seconds (default: 3600) */
  tokenLifetime?: number;
}

export interface MockOAuthServerState {
  registeredClients: Map<string, OAuthClientInformationFull>;
  issuedTokens: Map<string, OAuthTokens>;
  authorizationCodes: Map<string, AuthorizationCodeData>;
  codeVerifiers: Map<string, string>;
}

interface AuthorizationCodeData {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope?: string;
  state?: string;
  resource?: string;
  issuedAt: number;
}

/**
 * In-memory OAuth 2.1 server for tests.
 * @endpoints .well-known/*, /register, /token
 * @features RFC 7591 registration, PKCE validation
 * @invariant Stateful - tracks clients/tokens/codes
 */
export class MockOAuthServer {
  private config: MockOAuthServerConfig;
  private state: MockOAuthServerState;
  private handlers: Map<string, (req: Request) => Promise<Response>>;

  constructor(config: MockOAuthServerConfig) {
    this.config = config;
    this.state = {
      registeredClients: new Map(),
      issuedTokens: new Map(),
      authorizationCodes: new Map(),
      codeVerifiers: new Map(),
    };
    this.handlers = new Map();
    this.setupHandlers();
  }

  private setupHandlers(): void {
    const baseUrl = new URL(this.config.baseUrl);

    // Protected Resource Metadata
    this.handlers.set(
      `${baseUrl.origin}/.well-known/oauth-protected-resource`,
      this.handleResourceMetadata.bind(this),
    );

    // Authorization Server Metadata
    this.handlers.set(
      `${baseUrl.origin}/.well-known/oauth-authorization-server`,
      this.handleAuthServerMetadata.bind(this),
    );

    // Dynamic Client Registration
    this.handlers.set(
      `${baseUrl.origin}/register`,
      this.handleClientRegistration.bind(this),
    );

    // Token endpoint
    this.handlers.set(`${baseUrl.origin}/token`, this.handleToken.bind(this));
  }

  /**
   * Route request to appropriate handler.
   * @returns Mock response or 404
   */
  async handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const handler =
      this.handlers.get(url.href) ||
      this.handlers.get(url.origin + url.pathname);

    if (handler) {
      return await handler(req);
    }

    return new Response("Not Found", { status: 404 });
  }

  private async handleResourceMetadata(_req: Request): Promise<Response> {
    const metadata: OAuthProtectedResourceMetadata = {
      resource: this.config.baseUrl,
      authorization_servers: [`${this.config.baseUrl}`],
      ...this.config.resourceMetadata,
    };

    return new Response(JSON.stringify(metadata), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  private async handleAuthServerMetadata(_req: Request): Promise<Response> {
    const baseUrl = this.config.baseUrl;
    const metadata: AuthorizationServerMetadata = {
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/authorize`,
      token_endpoint: `${baseUrl}/token`,
      registration_endpoint: `${baseUrl}/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: [
        "client_secret_basic",
        "client_secret_post",
        "none",
      ],
      ...this.config.metadata,
    };

    return new Response(JSON.stringify(metadata), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  private async handleClientRegistration(req: Request): Promise<Response> {
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    try {
      const clientMetadata = await req.json();
      const clientId = `client_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      const clientInfo: OAuthClientInformationFull = {
        client_id: clientId,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        ...(clientMetadata as any),
      };

      // Add client_secret if not a public client
      if (this.config.requireClientAuth) {
        clientInfo.client_secret = `secret_${Math.random().toString(36).substring(2, 15)}`;
        clientInfo.client_secret_expires_at = 0; // Never expires
      }

      this.state.registeredClients.set(clientId, clientInfo);

      return new Response(JSON.stringify(clientInfo), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: "invalid_request",
          error_description: "Invalid client metadata",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  private async handleToken(req: Request): Promise<Response> {
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const contentType = req.headers.get("Content-Type");
    if (!contentType?.includes("application/x-www-form-urlencoded")) {
      return new Response(
        JSON.stringify({
          error: "invalid_request",
          error_description: "Invalid content type",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const body = await req.text();
    const params = new URLSearchParams(body);
    const grantType = params.get("grant_type");

    switch (grantType) {
      case "authorization_code":
        return this.handleAuthorizationCodeGrant(params, req);
      case "refresh_token":
        return this.handleRefreshTokenGrant(params, req);
      default:
        return new Response(
          JSON.stringify({ error: "unsupported_grant_type" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
    }
  }

  private async handleAuthorizationCodeGrant(
    params: URLSearchParams,
    req: Request,
  ): Promise<Response> {
    const code = params.get("code");
    const codeVerifier = params.get("code_verifier");
    const redirectUri = params.get("redirect_uri");
    const clientId = params.get("client_id");

    if (!code || !codeVerifier || !redirectUri) {
      return new Response(
        JSON.stringify({
          error: "invalid_request",
          error_description: "Missing required parameters",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // Validate client authentication
    const authResult = this.validateClientAuth(req, params);
    if (!authResult.valid) {
      return new Response(
        JSON.stringify({
          error: "invalid_client",
          error_description: authResult.error,
        }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    // Validate authorization code
    const codeData = this.state.authorizationCodes.get(code);
    if (!codeData) {
      return new Response(
        JSON.stringify({
          error: "invalid_grant",
          error_description: "Invalid authorization code",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // Check code expiration (10 minutes)
    if (Date.now() - codeData.issuedAt > 600000) {
      this.state.authorizationCodes.delete(code);
      return new Response(
        JSON.stringify({
          error: "invalid_grant",
          error_description: "Authorization code expired",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // Validate redirect URI
    if (codeData.redirectUri !== redirectUri) {
      return new Response(
        JSON.stringify({
          error: "invalid_grant",
          error_description: "Redirect URI mismatch",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // Validate PKCE
    const expectedChallenge = this.generateCodeChallenge(codeVerifier);
    if (codeData.codeChallenge !== expectedChallenge) {
      return new Response(
        JSON.stringify({
          error: "invalid_grant",
          error_description: "Invalid code verifier",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // Issue tokens
    const tokens: OAuthTokens = {
      access_token: `access_${Math.random().toString(36).substring(2, 15)}`,
      token_type: "Bearer",
      expires_in: this.config.tokenLifetime || 3600,
      refresh_token: `refresh_${Math.random().toString(36).substring(2, 15)}`,
      scope: codeData.scope,
    };

    this.state.issuedTokens.set(tokens.access_token, tokens);
    this.state.authorizationCodes.delete(code);

    return new Response(JSON.stringify(tokens), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  private async handleRefreshTokenGrant(
    params: URLSearchParams,
    req: Request,
  ): Promise<Response> {
    const refreshToken = params.get("refresh_token");

    if (!refreshToken) {
      return new Response(
        JSON.stringify({
          error: "invalid_request",
          error_description: "Missing refresh token",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // Validate client authentication
    const authResult = this.validateClientAuth(req, params);
    if (!authResult.valid) {
      return new Response(
        JSON.stringify({
          error: "invalid_client",
          error_description: authResult.error,
        }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    // Find existing token with this refresh token
    let existingTokens: OAuthTokens | undefined;
    for (const tokens of this.state.issuedTokens.values()) {
      if (tokens.refresh_token === refreshToken) {
        existingTokens = tokens;
        break;
      }
    }

    if (!existingTokens) {
      return new Response(
        JSON.stringify({
          error: "invalid_grant",
          error_description: "Invalid refresh token",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // Issue new access token
    const newTokens: OAuthTokens = {
      access_token: `access_${Math.random().toString(36).substring(2, 15)}`,
      token_type: "Bearer",
      expires_in: this.config.tokenLifetime || 3600,
      refresh_token: refreshToken, // Keep same refresh token
      scope: existingTokens.scope,
    };

    this.state.issuedTokens.set(newTokens.access_token, newTokens);

    return new Response(JSON.stringify(newTokens), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  private validateClientAuth(
    req: Request,
    params: URLSearchParams,
  ): { valid: boolean; clientId?: string; error?: string } {
    // Check Authorization header for Basic auth
    const authHeader = req.headers.get("Authorization");
    if (authHeader?.startsWith("Basic ")) {
      const credentials = atob(authHeader.substring(6));
      const [clientId, clientSecret] = credentials.split(":");
      const client = this.state.registeredClients.get(clientId || "");

      if (!client) {
        return { valid: false, error: "Unknown client" };
      }

      if (client.client_secret && client.client_secret !== clientSecret) {
        return { valid: false, error: "Invalid client credentials" };
      }

      return { valid: true, clientId };
    }

    // Check client credentials in body
    const clientId = params.get("client_id");
    const clientSecret = params.get("client_secret");

    if (!clientId) {
      return { valid: false, error: "Missing client_id" };
    }

    const client = this.state.registeredClients.get(clientId);
    if (!client) {
      return { valid: false, error: "Unknown client" };
    }

    if (client.client_secret && client.client_secret !== clientSecret) {
      return { valid: false, error: "Invalid client credentials" };
    }

    return { valid: true, clientId };
  }

  private generateCodeChallenge(verifier: string): string {
    // Simple mock implementation - in real implementation use crypto
    return Buffer.from(verifier).toString("base64url");
  }

  /**
   * Simulate user authorization and generate authorization code
   */
  simulateAuthorization(params: {
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    codeChallengeMethod: string;
    scope?: string;
    state?: string;
    resource?: string;
  }): string {
    const code = `code_${Math.random().toString(36).substring(2, 15)}`;

    this.state.authorizationCodes.set(code, {
      ...params,
      issuedAt: Date.now(),
    });

    return code;
  }

  /**
   * Get current server state for testing
   */
  getState(): MockOAuthServerState {
    return this.state;
  }

  /**
   * Clear all server state
   */
  reset(): void {
    this.state.registeredClients.clear();
    this.state.issuedTokens.clear();
    this.state.authorizationCodes.clear();
    this.state.codeVerifiers.clear();
  }
}

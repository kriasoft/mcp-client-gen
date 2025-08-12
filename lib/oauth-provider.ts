/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import type {
  OAuthClientProvider,
  OAuthClientMetadata,
  OAuthClientInformation,
  OAuthClientInformationFull,
  OAuthTokens,
  AuthorizationServerMetadata,
} from "@modelcontextprotocol/sdk/dist/esm/shared/auth.js";

export interface McpOAuthProviderOptions {
  redirectUrl: string | URL;
  clientMetadata: OAuthClientMetadata;
  storage?: OAuthStorage;
  onRedirect?: (url: URL) => void | Promise<void>;
}

export interface OAuthStorage {
  getClientInfo():
    | OAuthClientInformationFull
    | undefined
    | Promise<OAuthClientInformationFull | undefined>;
  saveClientInfo(info: OAuthClientInformationFull): void | Promise<void>;
  getTokens(): OAuthTokens | undefined | Promise<OAuthTokens | undefined>;
  saveTokens(tokens: OAuthTokens): void | Promise<void>;
  getCodeVerifier(): string | undefined | Promise<string | undefined>;
  saveCodeVerifier(verifier: string): void | Promise<void>;
  clear(): void | Promise<void>;
}

/**
 * In-memory storage for OAuth credentials (for testing)
 */
export class InMemoryOAuthStorage implements OAuthStorage {
  private clientInfo?: OAuthClientInformationFull;
  private tokens?: OAuthTokens;
  private codeVerifier?: string;

  getClientInfo(): OAuthClientInformationFull | undefined {
    return this.clientInfo;
  }

  saveClientInfo(info: OAuthClientInformationFull): void {
    this.clientInfo = info;
  }

  getTokens(): OAuthTokens | undefined {
    return this.tokens;
  }

  saveTokens(tokens: OAuthTokens): void {
    this.tokens = tokens;
  }

  getCodeVerifier(): string | undefined {
    return this.codeVerifier;
  }

  saveCodeVerifier(verifier: string): void {
    this.codeVerifier = verifier;
  }

  clear(): void {
    this.clientInfo = undefined;
    this.tokens = undefined;
    this.codeVerifier = undefined;
  }
}

/**
 * OAuth client provider implementation for MCP servers
 *
 * This provider handles:
 * - Dynamic client registration (RFC 7591)
 * - OAuth 2.0 authorization flow with PKCE
 * - Token storage and management
 * - Client credential management
 */
export class McpOAuthProvider implements OAuthClientProvider {
  private storage: OAuthStorage;
  private onRedirect?: (url: URL) => void | Promise<void>;
  private _redirectUrl: string | URL;
  private _clientMetadata: OAuthClientMetadata;

  constructor(options: McpOAuthProviderOptions) {
    this._redirectUrl = options.redirectUrl;
    this._clientMetadata = options.clientMetadata;
    this.storage = options.storage || new InMemoryOAuthStorage();
    this.onRedirect = options.onRedirect;
  }

  get redirectUrl(): string | URL {
    return this._redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return this._clientMetadata;
  }

  async state(): Promise<string> {
    // Generate a random state parameter for CSRF protection
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return btoa(String.fromCharCode(...array))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
  }

  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    const fullInfo = await this.storage.getClientInfo();
    if (!fullInfo) {
      return undefined;
    }

    // Return only the subset needed for OAuthClientInformation
    return {
      client_id: fullInfo.client_id,
      client_secret: fullInfo.client_secret,
    };
  }

  async saveClientInformation(
    clientInformation: OAuthClientInformationFull,
  ): Promise<void> {
    await this.storage.saveClientInfo(clientInformation);
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return await this.storage.getTokens();
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.storage.saveTokens(tokens);
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    if (this.onRedirect) {
      await this.onRedirect(authorizationUrl);
    } else {
      // Default behavior: log the URL for manual navigation
      console.log("Please navigate to the following URL to authorize:");
      console.log(authorizationUrl.href);
    }
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await this.storage.saveCodeVerifier(codeVerifier);
  }

  async codeVerifier(): Promise<string> {
    const verifier = await this.storage.getCodeVerifier();
    if (!verifier) {
      throw new Error("Code verifier not found");
    }
    return verifier;
  }

  async addClientAuthentication(
    headers: Headers,
    params: URLSearchParams,
    url: string | URL,
    metadata?: AuthorizationServerMetadata,
  ): Promise<void> {
    // This is optional - the SDK will handle client authentication
    // based on the client information and server metadata
    // We can leave this unimplemented to use default behavior
  }

  async validateResourceURL(
    serverUrl: string | URL,
    resource?: string,
  ): Promise<URL | undefined> {
    // Use default validation behavior
    return undefined;
  }

  async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier",
  ): Promise<void> {
    switch (scope) {
      case "all":
        await this.storage.clear();
        break;
      case "client":
        const currentInfo = await this.storage.getClientInfo();
        if (currentInfo) {
          await this.storage.saveClientInfo({
            ...currentInfo,
            client_id: "",
            client_secret: undefined,
          });
        }
        break;
      case "tokens":
        await this.storage.saveTokens({
          access_token: "",
          token_type: "Bearer",
        });
        break;
      case "verifier":
        await this.storage.saveCodeVerifier("");
        break;
    }
  }
}

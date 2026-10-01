/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * Core type definitions - shared across all modules; the public ones are re-exported by
 * `index.ts`.
 */

import type { BrowserAuthOptions } from "oauth-callback/mcp";

/** MCP server to connect to. */
export type McpServerConfig = {
  /** Server endpoint URL */
  url: string;
  /** Transport: Streamable HTTP (default) or legacy SSE */
  type?: "http" | "sse";
  /**
   * Name of the generated client, e.g. `notion` → `createNotionClient` (default: derived
   * from the URL). Unrelated to the OAuth `clientName` the server sees.
   */
  name?: string;
  /**
   * Headers added to requests to the server's origin, e.g. a static `Authorization`;
   * never sent to OAuth endpoints elsewhere
   */
  headers?: Record<string, string>;
};

/**
 * oauth-callback `browserAuth()` options. `serverUrl` comes from the server, and
 * `redirectUri` defaults to a fixed loopback URI. A `store` is bound to that one server
 * (default: memory).
 */
export type McpOAuthOptions = Omit<
  BrowserAuthOptions,
  "serverUrl" | "redirectUri"
> & { redirectUri?: BrowserAuthOptions["redirectUri"] };

/** Connection settings used while introspecting a server. */
export interface GenerateClientOptions {
  /**
   * OAuth 2.1 browser authorization settings. `false` never opens a browser: a server
   * demanding OAuth then fails generation (e.g. in CI).
   */
  oauth?: false | McpOAuthOptions;
  /** Custom fetch for proxies/interceptors */
  fetch?: typeof fetch;
  /** Timeout in ms for each request while connecting and listing (SDK default: 60s) */
  timeout?: number;
  /** Aborts connecting and listing, including a pending browser authorization */
  signal?: AbortSignal;
}

/**
 * Warning emitted during config parsing.
 * Structured for programmatic access and clear user messaging.
 */
export type ConfigWarning =
  | { kind: "malformed_json"; path: string; error: string }
  | { kind: "skipped_stdio"; path: string; name: string }
  | { kind: "missing_url"; path: string; name: string }
  | { kind: "invalid_url"; path: string; name: string }
  | { kind: "unknown_type"; path: string; name: string; type: string }
  /** Placeholders in url/headers with no value (e.g. `API_KEY`, `input:key`); never values */
  | {
      kind: "unresolved_placeholder";
      path: string;
      name: string;
      placeholders: string[];
    };

/**
 * Result of parsing MCP config files.
 */
export type ParseServersResult = {
  servers: McpServerConfig[];
  warnings: ConfigWarning[];
};

/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * Core type definitions - shared across all modules.
 */

/** MCP server to connect to. */
export type McpServerConfig = {
  /** Server endpoint URL */
  url: string;
  /** Transport: Streamable HTTP (default) or legacy SSE */
  type?: "http" | "sse";
  /** Client name, e.g. `notion` → `createNotionClient` (default: derived from the URL) */
  name?: string;
  /** Headers sent with every request, e.g. a static `Authorization` */
  headers?: Record<string, string>;
};

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
  /** Placeholders in url/headers with no value; names only, never values. */
  | { kind: "unresolved_env"; path: string; name: string; variables: string[] };

/**
 * Result of parsing MCP config files.
 */
export type ParseServersResult = {
  servers: McpServerConfig[];
  warnings: ConfigWarning[];
};

/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * Core type definitions - shared across all modules.
 */

/**
 * MCP server connection config.
 * @property type Transport protocol (http=streaming, sse=events)
 * @property url Server endpoint URL
 */
export type McpServerConfig = {
  type: "http" | "sse";
  url: string;
  /** Optional explicit name from config key */
  name?: string;
  /** Optional headers for authenticated requests */
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
  | { kind: "unknown_type"; path: string; name: string; type: string };

/**
 * Result of parsing MCP config files.
 */
export type ParseServersResult = {
  servers: McpServerConfig[];
  warnings: ConfigWarning[];
};

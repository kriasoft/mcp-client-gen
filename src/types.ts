/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * MCP server connection config.
 * @property type Transport protocol (http=streaming, sse=events)
 * @property url Server endpoint URL
 */
export type McpServer = {
  type: "http" | "sse";
  url: string;
};

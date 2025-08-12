/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

export type McpServer = {
  type: "http" | "sse";
  url: string;
};

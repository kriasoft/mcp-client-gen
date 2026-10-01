/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * Pipeline coordinator - introspection → codegen → formatting, for one server.
 *
 * Contract: generateClientModule(endpoint, options?) → code
 * Invariant: No file I/O; output depends only on the server's capabilities.
 */

import { format as prettierFormat, resolveConfig } from "prettier";
import { generateClientFile } from "./codegen/index.js";
import type { ConnectOptions, McpEndpoint } from "./connect.js";
import { introspectServer } from "./introspection.js";

/** How to name the generated client, and how to connect while introspecting. */
export interface GenerateClientOptions extends ConnectOptions {
  /**
   * Client name: `notion` → `createNotionClient` (default: derived from the URL).
   * Unrelated to the OAuth `clientName` the server sees.
   */
  name?: string;
}

/**
 * Generate the TypeScript module for one MCP server: a typed client factory over the SDK
 * `Client` (SPEC-api).
 * @param endpoint Server URL (Streamable HTTP), or the endpoint with transport and headers
 * @returns Formatted TypeScript source; nothing is written
 * @throws When the server can't be reached or introspected (SDK errors pass through)
 */
export async function generateClientModule(
  endpoint: string | URL | McpEndpoint,
  { name, ...options }: GenerateClientOptions = {},
): Promise<string> {
  const target: McpEndpoint =
    typeof endpoint === "string" || endpoint instanceof URL
      ? { url: endpoint }
      : endpoint;
  const snapshot = await introspectServer(target, options);
  return formatTypeScript(
    generateClientFile(extractServerName({ url: target.url, name }), snapshot),
  );
}

/**
 * Client name: the explicit one, else from the URL.
 * Priority: explicit name > URL hostname > URL path segment > "server"
 */
export function extractServerName({
  url: serverUrl,
  name,
}: {
  url: string | URL;
  name?: string;
}): string {
  // An empty name (e.g. a config key) still means "named": deriving from a config URL
  // could copy an expanded secret into generated identifiers
  if (name !== undefined) return name || "server";

  try {
    const url = new URL(serverUrl);
    // Extract subdomain or first path segment as name
    const hostname = url.hostname;
    const parts = hostname.split(".");
    // IP addresses and localhost name nothing (127.0.0.1 would yield "0")
    const namedHost =
      hostname !== "localhost" &&
      !hostname.startsWith("[") &&
      !/^\d+(\.\d+){3}$/.test(hostname);

    // Registrable label: "api.notion.com" -> "notion"; a country second-level suffix
    // ("example.co.uk") moves it one label left
    const secondLevel = /^(co|com|net|org|ac|gov|edu)$/.test(
      parts.at(-2) ?? "",
    );
    const suffixLabels =
      parts.length > 2 && secondLevel && parts.at(-1)!.length === 2 ? 2 : 1;
    if (namedHost && parts.length > suffixLabels) {
      const name = parts[parts.length - suffixLabels - 1];
      if (name && name !== "www" && name !== "api") {
        return name;
      }
    }

    // Try first path segment
    const pathSegment = url.pathname.split("/").filter(Boolean)[0];
    if (pathSegment && pathSegment !== "mcp" && pathSegment !== "v1") {
      return pathSegment;
    }

    return "server";
  } catch {
    return "server";
  }
}

/**
 * Format TypeScript code with Prettier.
 * @param filePath Destination whose Prettier config applies (searched upward); without
 *   it, Prettier's defaults, so output doesn't depend on the working directory
 * @throws When the code can't be parsed or the Prettier config is invalid
 */
export async function formatTypeScript(
  code: string,
  filePath?: string,
): Promise<string> {
  try {
    const prettierConfig = filePath
      ? ((await resolveConfig(filePath)) ?? {})
      : {};
    return await prettierFormat(code, {
      ...prettierConfig,
      parser: "typescript",
    });
  } catch (error) {
    // Unparsable output is a generator bug; a broken project config needs fixing: both
    // must surface, not ship unformatted code
    throw new Error(
      `Failed to format generated code: ${(error as Error).message}`,
      { cause: error },
    );
  }
}

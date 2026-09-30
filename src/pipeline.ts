/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * Pipeline coordinator - orchestrates introspection → codegen → formatting.
 *
 * Contract: generateClient(servers, options?) → GenerationResult
 * Invariant: Throws if all servers fail; generateClient() is pure (no file I/O).
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { format as prettierFormat, resolveConfig } from "prettier";
import { clientClassName, generateClientFile } from "./codegen/index.js";
import {
  introspectServers,
  type IntrospectionFailure,
  type IntrospectionSuccess,
} from "./introspection.js";
import type { McpClientConfig } from "./mcp-client.js";
import type { McpServerConfig } from "./types.js";

export interface GenerationOptions {
  /** MCP client config for connections */
  clientConfig?: McpClientConfig;
  /** Format with Prettier (default: true) */
  format?: boolean;
  /** Output file path for Prettier config resolution */
  outputPath?: string;
}

export interface GenerationResult {
  code: string;
  /** Exported factory function names (for CLI usage instructions) */
  exports: string[];
  servers: Map<string, IntrospectionSuccess>;
  failures: Map<string, IntrospectionFailure>;
}

/**
 * Extract a meaningful name from server config or URL.
 * Priority: explicit name > URL hostname > fallback index
 */
export function extractServerName(
  server: McpServerConfig,
  index: number,
): string {
  // An empty config key still means "named": deriving from a config URL could
  // copy an expanded secret into generated identifiers
  if (server.name !== undefined) return server.name || `server${index + 1}`;

  try {
    const url = new URL(server.url);
    // Extract subdomain or first path segment as name
    const hostname = url.hostname;
    const parts = hostname.split(".");
    // IP addresses and localhost name nothing (127.0.0.1 would yield "0")
    const namedHost =
      hostname !== "localhost" &&
      !hostname.startsWith("[") &&
      !/^\d+(\.\d+){3}$/.test(hostname);

    // Handle subdomains like "api.notion.com" -> "notion"
    if (namedHost && parts.length >= 2) {
      const name = parts.length > 2 ? parts[parts.length - 2] : parts[0];
      if (name && name !== "www" && name !== "api") {
        return name;
      }
    }

    // Try first path segment
    const pathSegment = url.pathname.split("/").filter(Boolean)[0];
    if (pathSegment && pathSegment !== "mcp" && pathSegment !== "v1") {
      return pathSegment;
    }

    return `server${index + 1}`;
  } catch {
    return `server${index + 1}`;
  }
}

/**
 * Server label for messages. Config servers show only their name: their URLs may
 * embed expanded secrets. A name derived from the URL comes with the URL itself.
 */
function describeServer(name: string, server: McpServerConfig): string {
  return server.name !== undefined ? `"${name}"` : `"${name}" (${server.url})`;
}

/**
 * Format TypeScript code with Prettier.
 * @param code Source code to format
 * @param filePath File path for Prettier config resolution (searches up from this path)
 * @returns Formatted code, or original if formatting fails
 */
export async function formatTypeScript(
  code: string,
  filePath?: string,
): Promise<string> {
  try {
    const prettierConfig = (await resolveConfig(filePath ?? ".")) ?? {};
    return await prettierFormat(code, {
      ...prettierConfig,
      parser: "typescript",
    });
  } catch {
    return code;
  }
}

/**
 * Generate TypeScript client from MCP servers.
 * Pipeline: introspect → aggregate → generate → format
 *
 * Note: This function does not write files. Use writeGeneratedClient() for that.
 */
export async function generateClient(
  servers: McpServerConfig[],
  options: GenerationOptions = {},
): Promise<GenerationResult> {
  if (servers.length === 0) {
    throw new Error("No servers provided");
  }

  // Names must map to distinct classes; check before introspecting (it may run OAuth)
  const names = servers.map((server, i) => extractServerName(server, i));
  const byClass = new Map<string, number[]>();
  names.forEach((name, i) => {
    const className = clientClassName(name);
    byClass.set(className, [...(byClass.get(className) ?? []), i]);
  });
  const collisions = [...byClass.values()].filter((ids) => ids.length > 1);
  if (collisions.length > 0) {
    const details = collisions
      .map((ids) =>
        ids
          .map((i) => `  - ${describeServer(names[i]!, servers[i]!)}`)
          .join("\n"),
      )
      .join("\n\n");
    throw new Error(
      `Server names collide in generated code. Give each server a distinct "name":\n\n${details}`,
    );
  }

  // Introspect all servers in parallel
  const results = await introspectServers(servers, options.clientConfig);

  // Aggregate successes and failures by derived server name
  const successes = new Map<string, IntrospectionSuccess>();
  const failures = new Map<string, IntrospectionFailure>();

  for (let i = 0; i < results.length; i++) {
    const result = results[i]!;
    const name = names[i]!;
    if (!result.ok) {
      failures.set(name, result);
    } else {
      successes.set(name, result);
    }
  }

  // Require at least one successful server
  if (successes.size === 0) {
    const errorDetails = Array.from(failures)
      .map(([name, f]) => `  - ${describeServer(name, f.server)}: ${f.error}`)
      .join("\n");
    throw new Error(`All servers failed to introspect:\n${errorDetails}`);
  }

  // Generate TypeScript code
  const result = generateClientFile(successes);

  // Format with Prettier
  let code = result.code;
  if (options.format !== false) {
    code = await formatTypeScript(code, options.outputPath);
  }

  return { code, exports: result.exports, servers: successes, failures };
}

/**
 * Write generated client code to a file.
 * Creates parent directories if needed.
 */
export async function writeGeneratedClient(
  outputPath: string,
  code: string,
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, code, "utf-8");
}

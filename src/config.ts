/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * Config discovery & parsing - finds and normalizes MCP server definitions.
 *
 * Contract: getMcpServers(paths) → McpServerConfig[]
 * Invariant: Only returns http/sse servers; first URL occurrence wins (dedup).
 */

import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { resolve } from "node:path";
import type {
  ConfigWarning,
  McpServerConfig,
  ParseServersResult,
} from "./types.js";

/**
 * Format a config warning for display.
 */
export function formatConfigWarning(warning: ConfigWarning): string {
  const file = basename(warning.path);
  switch (warning.kind) {
    case "malformed_json":
      return `${file}: Invalid JSON - ${warning.error}`;
    case "skipped_stdio":
      return `${file}: Skipped "${warning.name}" (stdio servers not supported)`;
    case "missing_url":
      return `${file}: Skipped "${warning.name}" (missing url)`;
    case "unknown_type":
      return `${file}: Skipped "${warning.name}" (unknown type "${warning.type}")`;
    case "unresolved_env":
      return `${file}: Skipped "${warning.name}" (unset environment variable ${warning.variables.join(", ")})`;
  }
}

/**
 * Parse JSON with comments and trailing commas (JSONC).
 * VS Code and Cursor mcp.json files are JSONC; a small scanner avoids a
 * dependency and Bun-only APIs (the CLI also runs on Node).
 */
export function parseJsonc(text: string): unknown {
  if (text.startsWith("\uFEFF")) text = text.slice(1); // BOM, common on Windows
  let out = "";
  let comma = -1; // Index in `out` of a comma that may turn out to be trailing
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    const next = text[i + 1];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
      comma = -1;
    } else if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n" && text[i] !== "\r") i++;
    } else if (ch === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      // A truncated file must fail, not silently drop its tail
      if (end === -1) throw new SyntaxError("Unterminated /* comment");
      i = end + 2;
      out += " ";
    } else {
      if ((ch === "}" || ch === "]") && comma !== -1) {
        out = out.slice(0, comma) + out.slice(comma + 1);
      }
      if (ch === ",") comma = out.length;
      else if (!/\s/.test(ch)) comma = -1;
      out += ch;
      i++;
    }
  }
  return JSON.parse(out);
}

/**
 * Values substituted from the environment, typically secrets. The CLI masks them in
 * everything it prints, since labels and SDK errors embed expanded URLs and headers.
 */
const substituted = new Set<string>();

/** Mask substituted values, as written or as serialized in a URL, in text meant for output. */
export function redactSecrets(text: string): string {
  // Longest first: a shorter secret inside a longer one must not leave a remainder
  const forms = [...substituted].sort((a, b) => b.length - a.length);
  return forms.reduce((out, form) => out.replaceAll(form, "***"), text);
}

/**
 * Record a substituted value in every form a URL may print it (errors echo URLs):
 * path, query and component encoding, and lowercased hosts. Very short values would
 * mask unrelated text, not secrets.
 */
function substitute(value: string): string {
  if (value.length < 4) return value;
  const url = new URL("http://host/");
  url.pathname = value;
  url.search = value;
  for (const form of [
    value,
    value.toLowerCase(),
    encodeURIComponent(value),
    encodeURI(value),
    url.pathname.slice(1),
    url.search.slice(1),
    new URLSearchParams([["k", value]]).toString().slice(2),
  ])
    substituted.add(form);
  return value;
}

const ENV_PLACEHOLDER = /\$\{([^}]*)\}/g;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Expand `${env:NAME}` (VS Code/Cursor), `${NAME}` and `${NAME:-default}`
 * (Claude Code) from process.env. Other placeholders, e.g. VS Code's
 * `${input:id}`, can't be resolved here and are reported via `missing`.
 */
function expandEnv(value: string, missing: Set<string>): string {
  return value.replace(ENV_PLACEHOLDER, (match, expr: string) => {
    const body = expr.startsWith("env:") ? expr.slice(4) : expr;
    const sep = body.indexOf(":-");
    const name = sep === -1 ? body : body.slice(0, sep);
    // Report names only: a fallback may be a secret. Nested placeholders in a
    // fallback aren't supported (the pattern ends at the first "}").
    const fallback = sep === -1 ? undefined : body.slice(sep + 2);
    if (!ENV_NAME.test(name) || fallback?.includes("${")) {
      missing.add(name || "(empty)");
      return match;
    }
    const envValue = process.env[name];
    if (sep === -1) {
      if (envValue !== undefined) return substitute(envValue);
      missing.add(name);
      return match;
    }
    // Shell semantics: `:-` also replaces an empty value
    // A fallback comes from the config file, but may be a secret all the same
    return substitute(envValue || fallback!);
  });
}

export interface ResolveConfigOptions {
  /** Working directory */
  cwd?: string;
  /** Explicit config path (skips discovery) */
  configPath?: string;
}

/**
 * Resolve config file paths: explicit path OR discovery.
 * Single source of truth for --config handling across all CLI modes.
 * @throws If explicit configPath doesn't exist or discovery finds nothing
 */
export async function resolveConfigFiles(
  options: ResolveConfigOptions = {},
): Promise<string[]> {
  const cwd = options.cwd ?? process.cwd();

  if (options.configPath) {
    const absolutePath = resolve(cwd, options.configPath);
    if (!existsSync(absolutePath)) {
      throw new Error(`Configuration file not found: ${options.configPath}`);
    }
    return [absolutePath];
  }

  const configFiles = await findMcpConfigFiles(cwd);
  if (configFiles.length === 0) {
    throw new Error(
      "No MCP configuration files found. Create a .mcp.json file with your MCP server configuration.",
    );
  }
  return configFiles;
}

/**
 * Priority-ordered paths for MCP configuration discovery.
 * .local files override non-local variants for local overrides.
 * @see https://code.visualstudio.com/docs/copilot/chat/mcp-servers
 */
export const MCP_CONFIG_PATHS = [
  ".mcp.local.json",
  ".mcp.json",
  ".cursor/mcp.local.json",
  ".cursor/mcp.json",
  ".vscode/mcp.local.json",
  ".vscode/mcp.json",
];

/**
 * Scan filesystem for MCP config files in priority order.
 * @param cwd Working directory to search from
 * @returns Absolute paths of existing config files
 */
export async function findMcpConfigFiles(
  cwd: string = process.cwd(),
): Promise<string[]> {
  const foundFiles: string[] = [];

  for (const configPath of MCP_CONFIG_PATHS) {
    const fullPath = resolve(cwd, configPath);
    if (existsSync(fullPath)) {
      foundFiles.push(fullPath);
    }
  }

  return foundFiles;
}

/**
 * Parse MCP configs and extract unique server definitions.
 * @param paths Config file paths to parse (in priority order)
 * @returns Deduplicated servers and any warnings encountered
 * @invariant Only returns http/sse servers, skips stdio/command servers
 * @supports Claude (.mcp.json), Cursor (.cursor/), VSCode (.vscode/) formats
 */
export function getMcpServers(paths: string[]): ParseServersResult {
  const servers: McpServerConfig[] = [];
  const warnings: ConfigWarning[] = [];
  const seenUrls = new Set<string>();

  for (const path of paths) {
    let config: unknown;
    try {
      config = parseJsonc(readFileSync(path, "utf8"));
    } catch (error) {
      warnings.push({
        kind: "malformed_json",
        path,
        error: (error as Error).message,
      });
      continue;
    }

    if (!config || typeof config !== "object" || Array.isArray(config)) {
      warnings.push({
        kind: "malformed_json",
        path,
        error: "Expected an object at the root",
      });
      continue;
    }

    // Claude/Cursor: mcpServers, VSCode: servers or mcp.servers
    const serverConfigs =
      (config as any).mcpServers ||
      (config as any).servers ||
      (config as any).mcp?.servers;

    if (serverConfigs && typeof serverConfigs === "object") {
      for (const [name, serverConfig] of Object.entries(serverConfigs)) {
        if (typeof serverConfig === "object" && serverConfig !== null) {
          const server = serverConfig as any;

          // Check for stdio servers (unsupported)
          if (server.type === "stdio" || server.command) {
            warnings.push({ kind: "skipped_stdio", path, name });
            continue;
          }

          const missing = new Set<string>();
          const trimmedUrl =
            typeof server.url === "string"
              ? expandEnv(server.url, missing).trim()
              : "";
          let headers: Record<string, string> | undefined;
          if (
            server.headers &&
            typeof server.headers === "object" &&
            !Array.isArray(server.headers)
          ) {
            headers = {};
            for (const [key, value] of Object.entries(server.headers)) {
              headers[key] =
                typeof value === "string"
                  ? expandEnv(value, missing)
                  : String(value);
            }
          }

          // Skip rather than send a literal placeholder as a URL or credential
          if (missing.size > 0) {
            warnings.push({
              kind: "unresolved_env",
              path,
              name,
              variables: [...missing],
            });
            continue;
          }

          // Check for missing URL
          if (!trimmedUrl) {
            warnings.push({ kind: "missing_url", path, name });
            continue;
          }

          // Skip duplicates silently (first URL wins is expected behavior)
          if (seenUrls.has(trimmedUrl)) {
            continue;
          }

          // Determine server type
          let serverType: "http" | "sse";
          if (server.type === "http" || server.type === "sse") {
            serverType = server.type;
          } else if (!server.type) {
            // Missing type defaults to http for URL-based servers
            serverType = "http";
          } else {
            warnings.push({
              kind: "unknown_type",
              path,
              name,
              type: String(server.type),
            });
            continue;
          }

          seenUrls.add(trimmedUrl);
          const result: McpServerConfig = {
            type: serverType,
            url: trimmedUrl,
            name,
          };

          if (headers) result.headers = headers;

          servers.push(result);
        }
      }
    }
  }

  return { servers, warnings };
}

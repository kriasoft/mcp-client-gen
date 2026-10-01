/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * Config discovery & parsing - finds and normalizes MCP server definitions.
 *
 * Contract: getMcpServers(paths) → McpServerConfig[]
 * Invariant: Only returns http/sse servers; the first usable entry claims its name and its connection.
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
    case "invalid_url":
      return `${file}: Skipped "${warning.name}" (url is not an http(s) URL)`;
    case "unknown_type":
      return `${file}: Skipped "${warning.name}" (unknown type "${warning.type}")`;
    case "unresolved_placeholder":
      return `${file}: Skipped "${warning.name}" (unresolved placeholder ${warning.placeholders.join(", ")})`;
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
 * Text the CLI must never print: values substituted from the environment (or fallbacks),
 * and the expanded config fields holding them. Labels, warnings and SDK errors embed
 * expanded URLs and headers, serialized in ways a single form can't anticipate.
 * Module state is deliberate: config parsing serves one CLI process, and every message
 * it prints, from any module, must pass through the same registry.
 */
const secrets = new Set<string>();

/** Shorter forms (normalization can produce "", e.g. `a/..`) would mask unrelated text. */
const MIN_SECRET_LENGTH = 4;

/** Mask every registered secret; overlapping matches merge, so no fragment survives. */
export function redactSecrets(text: string): string {
  const ranges: [number, number][] = [];
  for (const secret of secrets)
    for (
      let i = text.indexOf(secret);
      i !== -1;
      i = text.indexOf(secret, i + 1)
    )
      ranges.push([i, i + secret.length]);
  if (ranges.length === 0) return text;

  // Merge overlaps first: masking one match must not leave part of another visible
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [start, end] of ranges) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }

  let out = "";
  let pos = 0;
  for (const [start, end] of merged) {
    out += text.slice(pos, start) + "***";
    pos = end;
  }
  return out + text.slice(pos);
}

/**
 * An error's message, or any text, made safe for the terminal: control characters
 * stripped (a server's error page or a config key may carry escape sequences), secrets
 * masked before and after, since a secret may contain them or be split by them.
 */
export function printable(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value);
  return redactSecrets(
    redactSecrets(text).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, ""),
  );
}

/**
 * Register a secret as written, trimmed (header/URL normalization), URL-encoded, and as
 * error bodies commonly echo it (HTML-escaped 404 pages, JSON). Best effort: a server
 * may transform it in ways no list anticipates.
 */
function registerSecret(value: string): void {
  for (const form of new Set([value, value.trim()])) {
    if (form.length < MIN_SECRET_LENGTH) continue;
    const url = new URL("http://host/");
    url.pathname = form;
    url.search = form;
    const encoded = [
      form,
      form.toLowerCase(),
      encodeURIComponent(form),
      encodeURI(form),
      url.pathname.slice(1),
      url.search.slice(1),
      new URLSearchParams([["k", form]]).toString().slice(2),
    ];
    for (const variant of encoded.flatMap((e) => [e, ...escapes(e)]))
      if (variant.length >= MIN_SECRET_LENGTH) secrets.add(variant);
  }
}

/** HTML (both apostrophe styles) and JSON string escapings (plain and Go's HTML-safe). */
function escapes(text: string): string[] {
  const html = text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
  const json = JSON.stringify(text).slice(1, -1);
  return [
    html.replaceAll("'", "&#39;"),
    html.replaceAll("'", "&#x27;"),
    json,
    json
      .replaceAll("&", "\\u0026")
      .replaceAll("<", "\\u003c")
      .replaceAll(">", "\\u003e"),
  ];
}

/** Register an expanded config URL: any of its canonical pieces may carry the secret. */
function registerSecretUrl(expanded: string): void {
  registerSecret(expanded);
  if (!URL.canParse(expanded)) return;
  const url = new URL(expanded);
  for (const piece of [
    url.href,
    url.host,
    url.pathname + url.search,
    url.pathname,
    url.search.slice(1),
    // Servers echo single credentials too (e.g. "Invalid API key: …")
    ...url.searchParams.values(),
    ...url.pathname
      .split("/")
      .map((segment) => decodeURIComponentSafe(segment)),
    url.username,
    url.password,
  ])
    registerSecret(piece);
}

/**
 * Credentials a literal URL (in a config, or on the command line) carries: userinfo and
 * query values, as written (still encoded) and decoded once, since errors may echo either.
 */
export function registerUrlCredentials(url: string): void {
  if (!URL.canParse(url)) return;
  const { username, password, search, searchParams } = new URL(url);
  const rawQueryValues = search
    .slice(1)
    .split("&")
    .map((pair) => pair.slice(pair.indexOf("=") + 1));
  for (const piece of [
    username,
    password,
    decodeURIComponentSafe(username),
    decodeURIComponentSafe(password),
    ...rawQueryValues,
    ...searchParams.values(),
  ])
    registerSecret(piece);
}

function isHttpUrl(url: string): boolean {
  return URL.canParse(url) && /^https?:$/.test(new URL(url).protocol);
}

function decodeURIComponentSafe(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

const ENV_PLACEHOLDER = /\$\{([^}]*)\}/g;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Expand `${env:NAME}` (VS Code/Cursor), `${NAME}` and `${NAME:-default}`
 * (Claude Code) from process.env. Other placeholders, e.g. VS Code's
 * `${input:id}`, can't be resolved here and are reported via `missing`.
 */
function expandEnv(value: string, missing: Set<string>): string {
  const keep = (substituted: string) => (
    registerSecret(substituted),
    substituted
  );
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
      if (envValue !== undefined) return keep(envValue);
      missing.add(name);
      return match;
    }
    // Shell semantics: `:-` also replaces an empty value
    // A fallback comes from the config file, but may be a secret all the same
    return keep(envValue || fallback!);
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
 *
 * The first usable entry (in `paths` order) claims its name and its connection (type,
 * URL and headers); later entries with either are dropped. By name, so `.mcp.local.json`
 * overrides `.mcp.json` even with a different URL; by connection, so a server listed by
 * several tools is generated once, while one URL with different credentials (two
 * accounts) stays two servers. Skipped entries claim nothing: a broken override falls
 * back to the shared entry.
 * @param paths Config file paths to parse (in priority order)
 * @returns Deduplicated servers and any warnings encountered
 * @invariant Only returns http/sse servers, skips stdio/command servers
 * @supports Claude (.mcp.json), Cursor (.cursor/), VSCode (.vscode/) formats
 */
export function getMcpServers(paths: string[]): ParseServersResult {
  const servers: McpServerConfig[] = [];
  const warnings: ConfigWarning[] = [];
  const seenNames = new Set<string>();
  const seenConnections = new Set<string>();

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
          if (typeof server.url === "string" && server.url.includes("${"))
            registerSecretUrl(trimmedUrl);
          else registerUrlCredentials(trimmedUrl);
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
              // Any header value may be a credential, written literally or not; the
              // whole value, since printed errors show headers as sent (trimmed, joined)
              registerSecret(headers[key]!);
            }
          }

          // Skip rather than send a literal placeholder as a URL or credential
          if (missing.size > 0) {
            warnings.push({
              kind: "unresolved_placeholder",
              path,
              name,
              placeholders: [...missing],
            });
            continue;
          }

          // Check for missing URL
          if (!trimmedUrl) {
            warnings.push({ kind: "missing_url", path, name });
            continue;
          }

          if (!isHttpUrl(trimmedUrl)) {
            warnings.push({ kind: "invalid_url", path, name });
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

          // Overridden or listed twice (see above): skip silently
          const connection = JSON.stringify([
            serverType,
            // As fetch sends it: a default port or host case isn't another server
            new URL(trimmedUrl).href,
            // Header names are case-insensitive (not `new Headers()`: it throws on
            // values fetch would reject, which must fail that server, not parsing)
            Object.entries(headers ?? {})
              .map(([key, value]) => [key.toLowerCase(), value] as const)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
          ]);
          if (seenNames.has(name) || seenConnections.has(connection)) continue;

          seenNames.add(name);
          seenConnections.add(connection);
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

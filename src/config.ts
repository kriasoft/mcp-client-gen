/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * Config discovery & parsing - finds and normalizes MCP server definitions.
 *
 * Contract: getMcpServers(paths) → { servers: ConfiguredServer[], warnings }
 * Invariant: Only returns http/sse servers; the first usable entry claims its name and its connection.
 */

import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

/** A usable config entry: its key names the client. Header values are strings, as in JSON. */
export interface ConfiguredServer {
  name: string;
  url: string;
  transport: "http" | "sse";
  headers?: Record<string, string>;
}

/**
 * Why a config file or entry was skipped; names placeholders, never values. Reasons are
 * the generator's own words: parser messages may quote the file, secrets included.
 */
export type ConfigWarning =
  | { kind: "invalid_file"; path: string; reason: string }
  | { kind: "invalid_server"; path: string; name: string; reason: string }
  | { kind: "skipped_stdio"; path: string; name: string }
  | { kind: "missing_url"; path: string; name: string }
  | { kind: "invalid_url"; path: string; name: string }
  | { kind: "unknown_type"; path: string; name: string; type: string }
  /** Placeholders in url/headers with no value (e.g. `API_KEY`, `input:key`) */
  | {
      kind: "unresolved_placeholder";
      path: string;
      name: string;
      placeholders: string[];
    };

/**
 * Format a config warning for display, its file relative to `cwd`: `.cursor/mcp.json`
 * and `.vscode/mcp.json` share a base name.
 */
export function formatConfigWarning(
  warning: ConfigWarning,
  cwd: string = process.cwd(),
): string {
  const file = relative(cwd, warning.path);
  switch (warning.kind) {
    case "invalid_file":
      return `${file}: Skipped the file (${warning.reason})`;
    case "invalid_server":
      return `${file}: Skipped "${warning.name}" (${warning.reason})`;
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
 * An error's message, or any text, made safe for the terminal as one line: line breaks
 * and tabs become spaces (a server's error can't fake output lines), other control and
 * bidi characters are stripped (escape sequences, reordered text), and secrets are
 * masked before and after, since a secret may contain them or be split by them. Callers
 * compose multi-line output around printable values.
 */
export function printable(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value);
  return redactSecrets(
    redactSecrets(text)
      .replace(/[\t\n\v\f\r\u2028\u2029]/g, " ")
      .replace(
        /[\x00-\x1f\x7f-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,
        "",
      )
      .trim(),
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

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
export function getMcpServers(paths: string[]): {
  servers: ConfiguredServer[];
  warnings: ConfigWarning[];
} {
  const servers: ConfiguredServer[] = [];
  const warnings: ConfigWarning[] = [];
  const seenNames = new Set<string>();
  const seenConnections = new Set<string>();

  for (const path of paths) {
    let config: any;
    try {
      config = parseJsonc(readFileSync(path, "utf8"));
    } catch {
      warnings.push({ kind: "invalid_file", path, reason: "invalid JSON" });
      continue;
    }

    if (!isPlainObject(config)) {
      warnings.push({
        kind: "invalid_file",
        path,
        reason: "expected an object at the root",
      });
      continue;
    }

    // Claude/Cursor: mcpServers, VSCode: servers or mcp.servers. The first present one
    // is the file's server map, even if empty: sections aren't merged.
    const serverConfigs =
      config.mcpServers ??
      config.servers ??
      (isPlainObject(config.mcp) ? config.mcp.servers : undefined);
    if (serverConfigs === undefined) continue;
    if (!isPlainObject(serverConfigs)) {
      warnings.push({
        kind: "invalid_file",
        path,
        reason: "expected the server map to be an object",
      });
      continue;
    }

    for (const [name, server] of Object.entries(serverConfigs)) {
      if (!isPlainObject(server)) {
        warnings.push({
          kind: "invalid_server",
          path,
          name,
          reason: "not an object",
        });
        continue;
      }
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
      // Coercing a malformed value (`[object Object]`) would send a broken credential
      if (
        server.headers !== undefined &&
        !(
          isPlainObject(server.headers) &&
          Object.values(server.headers).every((v) => typeof v === "string")
        )
      ) {
        warnings.push({
          kind: "invalid_server",
          path,
          name,
          reason: "headers must be an object of strings",
        });
        continue;
      }
      let headers: Record<string, string> | undefined;
      if (server.headers) {
        headers = {};
        for (const [key, value] of Object.entries<string>(server.headers)) {
          headers[key] = expandEnv(value, missing);
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
      servers.push({
        name,
        url: trimmedUrl,
        transport: serverType,
        ...(headers && { headers }),
      });
    }
  }

  return { servers, warnings };
}

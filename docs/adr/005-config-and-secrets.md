# ADR-005 Config Sources and Secret Handling

**Status:** Accepted  
**Date:** 2026-10-01 (records decisions from 0.2.0 onward)  
**Tags:** config, cli, security

## Problem

- Users already describe their MCP servers in Claude Code, Cursor and VS Code configs; config mode should reuse them, with each tool's syntax (JSONC, env placeholders) and personal `.local` overrides.
- Those configs reference secrets through env placeholders. Once expanded, a secret can surface in anything the CLI prints: labels, SDK error messages, servers' error pages echoing a URL.

## Decision

- **CLI only.** Config discovery and parsing serve the CLI; the public API takes a server directly (ADR-003).
- **Formats:** every file parses as JSONC. Servers come from `mcpServers`, `servers` or `mcp.servers`, and only `http`/`sse` entries are used.
- **Precedence:** files are read in priority order (`.local` first, per tool); the first usable entry claims both its name and its connection (type, URL and headers). Skipped entries, including invalid URLs, claim nothing.
- **Env placeholders:** `${env:NAME}`, `${NAME}`, `${NAME:-fallback}` expand from the environment. Anything unresolvable skips the server with a warning naming the placeholders, never their values; a literal placeholder is never sent as a credential.
- **Warnings, not failures,** for skippable entries (`ConfigWarning`), printed to stderr.
- **Secrets:** every substituted value (including fallbacks), every header value and a literal URL's userinfo and query values are registered with its common serializations, and messages built from config values or SDK errors go through `redactSecrets()`. Beyond masking, failures and the usage snippet name entries instead of printing config URLs; warnings carry only names and raw-file parse errors. The registry is module state on purpose: one CLI process, one registry that output from every module must pass through.

## Alternatives (brief)

- Strict JSON — rejects the comments and trailing commas these tools accept.
- Deduplicate by URL only — a `.local` override with a different URL kept both entries, which then collided, and two accounts on one server collapsed into one.
- Pass unresolved placeholders through — sends `${TOKEN}` as a credential and leaks the variable name to the server.
- Refuse to print errors for config servers — hides the cause; redaction plus name-only labels keeps errors useful.
- A redaction context threaded through every call — more plumbing for the same behavior in a single-process CLI.

## Impact

- Positive: works with existing editor configs unchanged; secrets stay out of terminals and CI logs in the common cases.
- Negative/Risks: masking is best effort (a server that base64-encodes a secret bypasses it); short values (< 4 chars) aren't masked; path segments of URLs with placeholders are masked even when not secret.

## Links

- Code/Docs: `src/config.ts`, `src/cli.ts`, SPEC-config, SPEC-cli
- Related ADRs: ADR-001, ADR-003

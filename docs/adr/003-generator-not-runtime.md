# ADR-003 Generator, Not Runtime: Clients Wrap the SDK Client

**Status:** Accepted  
**Date:** 2026-10-01  
**Tags:** codegen, api

## Problem

- Generated clients took this package's `McpConnection`, so apps had to install the generator (ts-morph, Prettier, OAuth tooling) just to typecheck one generated file.
- Methods projected results: typed tools returned only `structuredContent` and threw a plain `Error` on `isError`, prompts returned only `messages`, resources only `contents`. The return shape flipped on whether a server declared `outputSchema`, and `content`, `_meta` and the failing result were lost.
- A class plus a factory exposed one abstraction twice; the class's `#connection` made its type nominal, so test doubles couldn't satisfy it.
- The package also published a runtime (`createMcpConnection()` with browser-only auth), config parsing, formatting and file helpers, all of which became API to keep stable.

## Decision

- **Input:** a factory per server takes the SDK `Client` the caller connected and owns. The generated file imports only types from `@modelcontextprotocol/client`, nothing from this package.
- **Shape:** the factory returns an object literal; its type is `export type {Server}Client = ReturnType<typeof create{Server}Client>` (structural, so trivially mocked).
- **Results:** methods return the SDK's full results. A tool with `outputSchema` returns `ToolResult<{Tool}Output>`, a `CallToolResult` refined so `structuredContent` is typed once `isError` is ruled out. Tool failures are data, as in the SDK; protocol failures throw.
- **Options:** the most specific SDK option type per call: `CallToolRequestOptions` for tools (e.g. `toolDefinition`), `RequestOptions` otherwise.
- Methods are one-line delegations with no runtime helpers.
- **Package:** a generator only. The root exports `generateClient(server, options?) → code` and its option types; connecting, OAuth (during generation), config discovery and formatting are internal, and there is no `/internal` entry. Apps connect with the SDK, and with `oauth-callback/mcp`'s `browserAuth().connect(client)` when a server needs OAuth; that provider also completes step-up authorizations.

## Alternatives (brief)

- Keep projections — lossy, and they hide the SDK's two error channels.
- Throw a generated `ToolError` on `isError` — a class per generated file breaks `instanceof` across files, and makes an expected outcome (a tool saying no, which agent loops feed back to the model) an exception.
- Class only (`new NotionClient(client)`) — nominal type; reads "client" twice.
- Validate `structuredContent` in generated code — duplicates the SDK, which validates against the listed tool definitions.
- Embed each typed tool's definition and pass it as `toolDefinition` — the SDK then validates without a prior `listTools()`, but an explicit definition disables its recovery from `Mcp-Param-*` header mismatches (it re-lists tools only when none was passed), so a server's later schema change would turn into hard failures; it also adds every schema to the module. The CLI's usage snippet calls `client.listTools()` once instead.
- Keep a public connection helper — duplicates `browserAuth().connect()`, ties apps to the generator's dependencies, and its browser-only auth can't express the SDK's other providers.
- Keep `/internal` as an unversioned extension point — exported paths become dependencies regardless of their name; add a small `/unstable` entry if a real need appears.

## Impact

- Positive: generated files need only the SDK; nothing is dropped; generated code is short enough to read at a glance; the package is a dev-time tool with one stable function.
- Negative/Risks: `ToolResult<T>` trusts the server's MCP obligation (a successful result with an output schema MUST carry conforming `structuredContent`). The SDK enforces it only after `client.listTools()` has cached the definitions; call it once to validate. Callers check `isError` before reading `structuredContent`; the type enforces that.

## Links

- Code/Docs: `src/codegen/`, SPEC-generated-client
- Related ADRs: ADR-001 (pipeline), ADR-002 (OAuth), ADR-004 (schema typing)

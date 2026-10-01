# ADR-003 Generated Clients Wrap the SDK Client

**Status:** Accepted  
**Date:** 2026-10-01  
**Tags:** codegen, api

## Problem

- Generated clients took this package's `McpConnection`, so apps had to install the generator (ts-morph, Prettier, OAuth tooling) just to typecheck one generated file.
- Methods projected results: typed tools returned only `structuredContent` and threw a plain `Error` on `isError`, prompts returned only `messages`, resources only `contents`. The return shape flipped on whether a server declared `outputSchema`, and `content`, `_meta` and the failing result were lost.
- A class plus a factory exposed one abstraction twice; the class's `#connection` made its type nominal, so test doubles couldn't satisfy it.

## Decision

- **Input:** a factory per server takes the SDK `Client` the caller connected and owns. The generated file imports only types from `@modelcontextprotocol/client`, nothing from this package.
- **Shape:** the factory returns an object literal; its type is `export type {Server}Client = ReturnType<typeof create{Server}Client>` (structural, so trivially mocked).
- **Results:** methods return the SDK's full results. A tool with `outputSchema` returns `ToolResult<{Tool}Output>`, a `CallToolResult` refined so `structuredContent` is typed once `isError` is ruled out. Tool failures are data, as in the SDK; protocol failures throw.
- **Options:** the most specific SDK option type per call: `CallToolRequestOptions` for tools (e.g. `toolDefinition`), `RequestOptions` otherwise.
- Methods are one-line delegations with no runtime helpers.

## Alternatives (brief)

- Keep projections — lossy, and they hide the SDK's two error channels.
- Throw a generated `ToolError` on `isError` — a class per generated file breaks `instanceof` across files, and makes an expected outcome (a tool saying no, which agent loops feed back to the model) an exception.
- Class only (`new NotionClient(client)`) — nominal type; reads "client" twice.
- Validate `structuredContent` in generated code — duplicates the SDK, which validates against the listed tool definitions.

## Impact

- Positive: generated files need only the SDK; nothing is dropped; generated code is short enough to read at a glance.
- Negative/Risks: `ToolResult<T>` trusts the server's MCP obligation (a successful result with an output schema MUST carry conforming `structuredContent`). The SDK enforces it only after `client.listTools()` has cached the definitions; call it once to validate. Callers check `isError` before reading `structuredContent`; the type enforces that.

## Links

- Code/Docs: `src/codegen/`, SPEC-generated-client
- Related ADRs: ADR-001 (pipeline), ADR-002 (OAuth)

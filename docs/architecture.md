# Architecture

`mcp-client-gen` turns a remote MCP server's advertised tools, prompts and resources into a thin, typed TypeScript module over the official SDK `Client`. It is a generator, not a runtime (ADR-003). Generated modules add static types and ergonomic names but never change MCP semantics, and they need only `@modelcontextprotocol/client`.

## Pipeline

```mermaid
flowchart LR
  subgraph Public API
    API["generateClientModule()<br/>index.ts → pipeline.ts"]
  end
  subgraph CLI
    CLI[cli.ts] --> PROMPTS[prompts.ts]
    PROMPTS --> CFG[config.ts]
  end
  API --> INTRO
  CLI --> INTRO[introspection.ts]
  INTRO --> CONN[connect.ts]
  CONN --> SDK["@modelcontextprotocol/client"]
  CONN --> OAUTH["oauth-callback/mcp"]
  API --> CODEGEN[codegen/*]
  CLI --> CODEGEN
  CODEGEN --> TSMORPH[ts-morph]
  API --> FMT["formatTypeScript()<br/>pipeline.ts"]
  CLI --> FMT
  FMT --> PRETTIER[prettier]
```

One server flows through four steps:

1. **Introspect:** connect (with OAuth when demanded), list capabilities, close → `ServerSnapshot` (SPEC-introspection, ADR-002).
2. **Generate:** snapshot → one TypeScript module via the ts-morph AST (SPEC-generated-client, ADR-004).
3. **Format:** Prettier.
4. **Output:** the library returns the code. The CLI writes files: one per server in config mode, only after every server succeeds (SPEC-cli, ADR-001).

The library and the CLI compose the same internals. The CLI calls them directly, because it also needs the snapshot's `authorized` flag (for the usage snippet) and formats with the destination's Prettier config. The library uses Prettier defaults.

## Modules

| Module                                | Responsibility                                                                       | Depends on                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `src/index.ts`                        | Public API (SPEC-api): `generateClientModule` and its two types; nothing else        | pipeline; connect (types)                                               |
| `src/pipeline.ts`                     | `generateClientModule`, `GenerateClientOptions`, client naming, Prettier formatting  | codegen, introspection, prettier; connect (types)                       |
| `src/cli.ts`                          | Modes, staged writes, usage snippet, exit codes                                      | codegen, config, introspection, pipeline, prompts; connect (types)      |
| `src/prompts.ts`                      | Interactive prompts, config loading for CLI modes, spinners                          | config, @clack/prompts                                                  |
| `src/config.ts`                       | Config discovery and parsing, env expansion, secret redaction, `ConfigWarning` (CLI) | —                                                                       |
| `src/introspection.ts`                | Connect → list (step-up retries) → close; returns the `ServerSnapshot`               | connect, SDK                                                            |
| `src/connect.ts`                      | `McpEndpoint`, SDK client, Streamable HTTP / SSE transports, generation-time OAuth   | SDK, oauth-callback                                                     |
| `src/codegen/file-builder.ts`         | One server's module: imports, `ToolResult<T>`, declarations                          | client-generator, tool-input-generator, ts-morph; introspection (types) |
| `src/codegen/client-generator.ts`     | Factory: tool methods, `prompts` / `resources` namespaces; name allocation           | tool-input-generator, utils; introspection, SDK, ts-morph (types)       |
| `src/codegen/tool-input-generator.ts` | Tool input/output type aliases                                                       | schema-to-typescript, utils; SDK, ts-morph (types)                      |
| `src/codegen/schema-to-typescript.ts` | JSON Schema → TypeScript; recursive aliases and the circularity check                | utils, ts-morph                                                         |
| `src/codegen/utils.ts`                | Casing, property keys, JSDoc sanitizing, `uniqueName`                                | —                                                                       |

**Dependency rule:** lower modules never import higher ones at runtime. Imports listed with "(types)" are type-only; codegen may import the `ServerSnapshot` type, but not the code that produces it. Types live with the module that owns their meaning; there is no shared `types.ts`.

- `codegen/*` knows nothing about connections, config or the CLI.
- `connect.ts` knows nothing about codegen.
- `config.ts` serves only the CLI.

## Invariants

Changes must keep these true; each links to where it's defined and tested.

| Invariant                                                                                                                                                                                                                                             | Defined in                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Generated modules import only types, only from `@modelcontextprotocol/client`, and contain no runtime helpers (the one exception: an era check when output types depend on the protocol era)                                                          | ADR-003, SPEC-generated-client |
| Generated modules compile under `strict` + `noUnusedLocals` for any server input (hostile names, recursive schemas)                                                                                                                                   | SPEC-generated-client, ADR-004 |
| Generated methods return the SDK's results unchanged; tool failures are data (`isError`)                                                                                                                                                              | ADR-003                        |
| Generated types are never stricter than the schema, except the two documented cases                                                                                                                                                                   | ADR-004                        |
| Output is deterministic: an unchanged server (catalog and protocol revision) regenerates byte-identical code with the same installed dependencies, whatever its listing order (library output also ignores cwd)                                       | SPEC-generated-client          |
| The public API is `generateClientModule` and its two types (SPEC-api); no other entry points                                                                                                                                                          | ADR-003                        |
| Config mode changes no file unless every server succeeds; writes are staged; servers are introspected one at a time                                                                                                                                   | ADR-001, SPEC-cli              |
| OAuth tokens are only sent to `https:` or loopback servers; no browser flow outlives generation, except a step-up that `signal` aborts mid-listing (ADR-002 Impact)                                                                                   | ADR-002                        |
| Registered secrets (expanded config values, literal credentials, command-line URL credentials) are masked in every common serialization before CLI output, and config URLs are never printed; best effort, a transformed secret (e.g. base64) escapes | ADR-005, SPEC-config           |
| Errors propagate unchanged (types and causes); the CLI labels them with server names                                                                                                                                                                  | SPEC-introspection             |
| `src/` runs on Node 22+ (no Bun-only APIs); Bun is the dev toolchain                                                                                                                                                                                  | `package.json` `engines`       |

## Dependencies

| Package                             | Kind       | Why                                                                                                                                               |
| ----------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@modelcontextprotocol/client` ^2.2 | dependency | Generation-time client. No SDK object crosses into apps: generated modules import the app's own SDK types, so the generator's copy is independent |
| `oauth-callback` ^3                 | dependency | Browser OAuth provider during generation (same maintainer); apps add it themselves if they use it                                                 |
| `ts-morph` ^28                      | dependency | AST code generation and the in-memory circularity check; bundles TypeScript                                                                       |
| `prettier` ^3                       | dependency | Formatting generated modules                                                                                                                      |
| `@clack/prompts` ^1                 | dependency | Interactive CLI                                                                                                                                   |

## Packaging

- **JavaScript:** `bun build --packages external` emits `dist/cli.js` and `dist/index.js`.
- **Types:** `tsc -p tsconfig.build.json` emits `.d.ts` files reachable from `src/index.ts`.
- **Exports:** `package.json` exports only `"."` and the `mcp-client-gen` bin. ESM only; Node.js 22+.
- **Releases:** publishing a GitHub release triggers the npm publish workflow, gated by the `release` environment approval; `prepublishOnly` runs `validate` (format, typecheck, all tests), `build`, then `smoke:package`: the packed tarball installed into a clean project and run under Node (CLI, library, generated code compiled with `skipLibCheck: false`). CI runs the same smoke on Node 22.

## Tests

| Layer      | Approach                                                                                                                                                                                               | Files                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| Codegen    | Hostile-name fixture compiled under `strict` against real SDK types; consumer-side typechecks (`@ts-expect-error`); output transpiled and run against a fake `Client`; compiler-backed recursion cases | `src/codegen.test.ts`                      |
| Connection | Real in-process servers: `@modelcontextprotocol/server` (Streamable HTTP), a legacy SSE fixture, oauth-callback's mock OAuth server (step-up, abort)                                                   | `src/introspection.test.ts`, `test/utils/` |
| Config     | Temp config files: formats, precedence, env expansion, redaction                                                                                                                                       | `src/config.test.ts`                       |
| CLI        | The real CLI in a subprocess: streams, exit codes, staged writes after every server succeeds, secret non-disclosure                                                                                    | `src/cli.test.ts`                          |
| Package    | The packed tarball in a clean consumer under Node: CLI, library import, generated code compiled (`skipLibCheck: false`) and run against an in-process server                                           | `test/package-smoke.ts`                    |
| Manual     | Real Notion server: fixture capture, example regeneration, smoke and E2E scripts                                                                                                                       | `test/manual/`, `test/e2e/`                |

- **Isolation:** tests run with `--isolate`, because `mock.module()` is process-global.
- **Hangs:** a test that could hang bounds its own wait, so a regression fails fast instead of stalling the suite.
- **Fixtures:** `examples/notion-client.ts` is regenerated offline from `test/fixtures/notion/` (`bun capture:notion --from-fixtures`).

## Documents

| Document                                   | Read when                                                               |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| SPEC-api                                   | changing anything `mcp-client-gen` exports                              |
| SPEC-generated-client                      | changing what generated code looks like: shape, naming, type mapping    |
| SPEC-introspection                         | changing connection, listing, OAuth wiring or generation options        |
| SPEC-cli                                   | changing modes, arguments, file writes, usage output or exit codes      |
| SPEC-config                                | changing config discovery, formats, env expansion or redaction          |
| ADR-001 Generator pipeline                 | why one module per server, written after all succeed, sequential        |
| ADR-002 OAuth flow                         | why the SDK + oauth-callback own OAuth; deferred CIMD, fixed port       |
| ADR-003 Generator, not runtime             | why generated code wraps the SDK `Client` and the API is one function   |
| ADR-004 JSON Schema typing policy          | why types are looser-not-stricter and how recursion is typed            |
| ADR-005 Config sources and secret handling | why config works the way it does and how secrets are kept out of output |

Specs live in `docs/specs/{name}.md`, ADRs in `docs/adr/NNN-slug.md`.

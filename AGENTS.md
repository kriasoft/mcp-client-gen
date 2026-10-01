# MCP Client Generator

@AGENTS.local.md

## Documentation

Start with `docs/architecture.md`: pipeline, module boundaries, invariants, and which document to read for a change.

- **SPECs** (`docs/specs/{name}.md`, referenced as SPEC-{name}): what the system does — `api`, `generated-client`, `introspection`, `cli`, `config`. Specs are the contract; update them in the same commit as the code.
- **ADRs** (`docs/adr/NNN-slug.md`, referenced as ADR-NNN): why, and what was rejected — 001 pipeline, 002 OAuth, 003 generator not runtime, 004 schema typing, 005 config and secrets. Revise in place when a decision changes (see `000-template.md`).
- `local/` is gitignored scratch (review handoffs, drafts); never a source of truth.

## Run Commands

```bash
# URL mode (primary)
npx mcp-client-gen <url>                    # Generate to stdout
npx mcp-client-gen <url> -o <file>          # Generate to file

# Config mode (uses .mcp.json, .cursor/, .vscode/): one module per server, written only after every server succeeds
npx mcp-client-gen                          # Interactive
npx mcp-client-gen -y                       # Quick defaults (src/mcp/ or mcp/)
npx mcp-client-gen -o <dir>                 # Quick, custom output directory (implies -y)
npx mcp-client-gen ... --no-oauth           # Either mode: fail instead of opening a browser
```

## Test Commands

```bash
bun test                        # Unit tests only (src/)
bun test:e2e                    # E2E tests only (test/e2e/)
bun test:all                    # Run all tests
bun typecheck                   # TypeScript check
bun format                      # Format code with Prettier
bun format:check                # Check code formatting
bun validate                    # Full validation (format, typecheck, tests)
```

## Manual Test Scripts

```bash
bun capture:notion                  # Capture fixtures + generate example
bun capture:notion --fixtures-only  # Capture fixtures only
bun capture:notion --from-fixtures  # Regenerate example from saved fixtures (offline)
bun smoke:notion                    # Smoke test generated client (no server)
bun e2e:notion                      # E2E test with real Notion server
```

## File Map

```bash
mcp-client-gen/
├── src/
│   ├── index.ts           # Public API: generateClientModule + its types (SPEC-api)
│   │
│   # CLI & User Interface
│   ├── cli.ts             # CLI entry - modes, file writes, usage snippets
│   ├── prompts.ts         # Interactive prompts (@clack/prompts)
│   │
│   # Configuration
│   ├── config.ts          # MCP config loading (.mcp.json, .cursor/, .vscode/), ConfigWarning
│   │
│   # MCP Protocol
│   ├── connect.ts         # McpEndpoint; generation-time connection (HTTP/SSE), OAuth via oauth-callback
│   ├── introspection.ts   # Capability snapshot: connect, list (step-up), close
│   │
│   # Code Generation
│   ├── codegen/
│   │   ├── index.ts           # Codegen module exports
│   │   ├── file-builder.ts    # Assembles one server's module
│   │   ├── client-generator.ts # Per-server factory with tool/prompt/resource methods
│   │   ├── tool-input-generator.ts # Tool input/output types
│   │   ├── schema-to-typescript.ts # JSON Schema → TypeScript types
│   │   └── utils.ts           # camelCase, pascalCase helpers
│   │
│   └── pipeline.ts        # generateClientModule: introspect → generate → format
│
├── docs/
│   ├── adr/               # Architecture Decision Records
│   └── specs/             # Design specifications
│
├── test/
│   ├── e2e/               # End-to-end tests (.spec.ts)
│   ├── fixtures/          # Test fixtures
│   │   ├── notion/        # Real Notion server data
│   │   └── synthetic/     # Minimal/edge-case schemas
│   └── manual/            # Manual capture scripts
│
├── examples/              # Example generated clients
│   └── notion-client.ts
│
└── package.json
```

## Pipeline

`CLI → Config → Connect → Introspect → Generate → Output`

Keep module DAG clean: lower modules must not import from higher ones.

## Key Constraints

- Toolchain: Bun for development (tests, scripts; it auto-loads .env files). The published CLI and library run on Node.js 22+ (and Bun): no Bun-only APIs under `src/`
- MCP SDK: `@modelcontextprotocol/client` ^2.2 (single entry point). The SDK owns OAuth; `oauth-callback/mcp` supplies the browser + loopback provider (ADR-002)
- Generated Client: a factory per server taking the SDK `Client`, returning full SDK results; type-only SDK imports only (ADR-003), valid under `strict` + `noUnusedLocals` (SPEC-generated-client)
- Design Philosophy: Prioritize ideal design over backward compatibility

## Error Handling

- **Throw errors** for failures; let SDK errors propagate unchanged (types and causes intact) and label them where they are reported (the CLI prefixes the server name)
- **Structured warnings** for skippable config entries (`ConfigWarning`)
- Config mode writes only after every server succeeds: one failing server fails the run before any file changes (ADR-001)
- Error messages: include context ("Tool 'search' error: ..."), never stack traces to users
- CLI output: pass errors and anything derived from config (URLs, headers, names) through `printable()` (strips control characters, then `redactSecrets()`): env placeholders expand to secrets. Masking covers common serializations (URL encodings, HTML/JSON escaping), so prefer names over config values in messages

## Naming Conventions

- Files: `kebab-case.ts`
- Constants: `SCREAMING_SNAKE_CASE`
- Private fields: `_underscorePrefix`

## Testing Guidelines

**What to test:**

- Pure functions (schema conversion, name extraction)
- Error conditions and edge cases
- Config parsing with various formats

**What to mock:**

- MCP server connections (use fixtures)
- File system for config discovery
- OAuth flows (use in-memory store)

**Isolation:** test scripts pass `--isolate` because `mock.module()` is process-global; without it a mocked module leaks into other files.

**Test file naming:**

- Unit tests: `{module}.test.ts` in same directory
- E2E tests: `test/e2e/{feature}.spec.ts`

## Public API

```typescript
import { generateClientModule } from "mcp-client-gen";
```

- `generateClientModule(endpoint, options?)` — introspect one server (URL or `McpEndpoint`) and return the formatted client module source; writes nothing. `options.name` names the client

Types: `McpEndpoint`, `GenerateClientOptions`. Contract: SPEC-api; types live with the module that owns them (no `types.ts`)

Everything else (connection, OAuth, config discovery, formatting, codegen) is internal; there is no `/internal` entry (ADR-003). Generated modules import only SDK types.

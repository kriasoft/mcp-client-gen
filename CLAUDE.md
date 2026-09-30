# MCP Client Generator

@AGENTS.local.md

## Documentation

**ADRs** (`docs/adr/NNN-slug.md`): Architectural decisions (reference as ADR-NNN)  
**SPECs** (`docs/specs/slug.md`): Design specifications (reference as SPEC-slug)

## Run Commands

```bash
# URL mode (primary)
npx mcp-client-gen <url>                    # Generate to stdout
npx mcp-client-gen <url> -o <file>          # Generate to file
npx mcp-client-gen <url> <file>             # Shorthand

# Config mode (uses .mcp.json, .cursor/, .vscode/)
npx mcp-client-gen                          # Interactive
npx mcp-client-gen -y                       # Quick defaults
npx mcp-client-gen -o <file>                # Quick, custom output (implies -y)
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
bun smoke:notion                    # Smoke test generated client (no server)
bun e2e:notion                      # E2E test with real Notion server
```

## File Map

```bash
mcp-client-gen/
├── src/
│   ├── index.ts           # Public API exports
│   ├── internal.ts        # Internal API exports (mcp-client-gen/internal)
│   │
│   # CLI & User Interface
│   ├── cli.ts             # CLI entry - argument parsing, execution modes
│   ├── prompts.ts         # Interactive prompts (@clack/prompts)
│   │
│   # Configuration
│   ├── config.ts          # MCP config loading (.mcp.json, .cursor/, .vscode/)
│   ├── types.ts           # Core type definitions (McpServerConfig)
│   │
│   # MCP Protocol
│   ├── mcp-client.ts      # MCP connection (HTTP/SSE), OAuth via oauth-callback
│   ├── introspection.ts   # Server capability discovery and caching
│   │
│   # Code Generation
│   ├── codegen/
│   │   ├── index.ts           # Codegen module exports
│   │   ├── file-builder.ts    # Assembles complete TypeScript file
│   │   ├── class-generator.ts # Client class with tool/resource methods
│   │   ├── tool-input-generator.ts # Tool input/output types
│   │   ├── schema-to-typescript.ts # JSON Schema → TypeScript types
│   │   └── utils.ts           # camelCase, pascalCase helpers
│   │
│   ├── pipeline.ts        # Pipeline orchestrator - coordinates all steps
│   └── utils.ts           # Shared utilities
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

- Runtime: Always use Bun (not Node.js/NPM). Bun auto-loads .env files
- MCP SDK: `@modelcontextprotocol/client` 2.x (single entry point). The SDK owns OAuth; `oauth-callback/mcp` supplies the browser + loopback provider (ADR-002)
- Generated Client: Type-only SDK imports, one class per server (unused servers tree-shake), valid under `strict` + `noUnusedLocals` (SPEC-generated-client)
- Design Philosophy: Prioritize ideal design over backward compatibility

## Error Handling

- **Throw errors** for unrecoverable failures (missing config, all servers failed)
- **Discriminated unions** for per-item failures (introspection returns `{ ok: true, ... } | { ok: false, error }`)
- **Console.warn** for non-fatal issues (single capability fetch failure)
- Error messages: include context ("Tool 'search' error: ..."), never stack traces to users
- CLI output: pass anything derived from config (URLs, headers, SDK error messages) through `redactSecrets()`: env placeholders expand to secrets

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
import { generateClient, createMcpConnection } from "mcp-client-gen";
```

- `generateClient(servers, options?)` — generate TypeScript client
- `writeGeneratedClient(path, code)` — write generated code to file
- `createMcpConnection(server, config?)` — establish MCP connection
- `resolveConfigFiles(options?)` — resolve config paths (explicit or discovery)
- `getMcpServers(paths)` — parse config files, returns `{ servers, warnings }`
- `formatConfigWarning(warning)` — format a config warning for display
- `findMcpConfigFiles(cwd?)` — discover config files
- `formatTypeScript(code, configPath?)` — format code with Prettier
- `fileStore(path)` — persistent OAuth credential store (one per server)

Types: `McpServerConfig`, `ConfigWarning`, `ParseServersResult`, `McpConnection`, `McpClientConfig`, `McpOAuthOptions`, `CredentialStore`, `GenerationOptions`, `GenerationResult`, `IntrospectionResult`, `ResolveConfigOptions`, `Tool`, `Resource`, `Prompt`, `ServerCapabilities`

## Internal API

```typescript
import {
  introspectServer,
  jsonSchemaToTypeScript,
} from "mcp-client-gen/internal";
```

Not covered by semver — use for custom pipelines:

- `introspectServer()`, `introspectServers()`
- `generateClientFile()`, `generateClientClass()`, `generateToolInputType()`, `generateToolOutputType()`
- `jsonSchemaToTypeScript()`, `hasOutputSchema()`, `MCP_CONFIG_PATHS`, `extractServerName()`

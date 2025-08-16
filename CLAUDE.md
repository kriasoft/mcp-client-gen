# MCP Client Generator

## Run Commands

```bash
npx mcp-client-gen              # Interactive mode with prompts
npx mcp-client-gen -y           # Quick mode, accept defaults
npx mcp-client-gen <output>     # Direct mode with output file
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
bun run test/manual/notion-generate.ts    # Generate Notion MCP client with OAuth
```

## File Map

```bash
mcp-client-gen/
├── src/
│   ├── index.ts           # Main library entry point - public API exports
│   │
│   # CLI & User Interface
│   ├── cli.ts             # CLI entry point - argument parsing, execution modes
│   ├── prompts.ts         # Interactive prompts using @clack/prompts
│   │
│   # Configuration
│   ├── config.ts          # MCP config loading (.mcp.json, .cursor/, .vscode/)
│   ├── types.ts           # TypeScript type definitions for all modules
│   │
│   # MCP Protocol
│   ├── mcp-client.ts      # MCP server communication (HTTP/SSE/stdio)
│   ├── introspection.ts   # Server capability discovery and caching
│   ├── schema.ts          # JSON Schema validation and transformation
│   │
│   # Authentication
│   ├── oauth-provider.ts  # OAuth 2.1 with RFC 7591 dynamic registration
│   ├── oauth-storage.ts   # Token storage interfaces and implementations
│   │
│   # Code Generation
│   ├── codegen.ts         # TypeScript AST generation using ts-morph
│   ├── generator.ts       # Pipeline orchestrator - coordinates all steps
│   │
│   └── utils.ts           # Shared utilities (string ops, file ops, etc.)
│
├── test/
│   ├── e2e/                     # End-to-end automated tests (.spec.ts)
│   ├── manual/                  # Manual integration scripts
│   │   └── notion-generate.ts   # Generate Notion client with OAuth
│   ├── fixtures/                # Test data and mock responses
│   └── utils/                   # Test utilities (mock servers, helpers)
│
├── examples/                    # Example generated clients and usage
│   ├── notion-generated.ts      # Generated Notion client (from manual test)
│   ├── notion-capabilities.json # Notion server capabilities
│   └── notion-usage.ts          # Usage examples for Notion client
│
└── package.json                 # Project configuration and dependencies
```

## Processing Pipeline

CLI → Config → Connect → Introspect → Generate → Output

- `cli.ts` → Parse args, determine mode (interactive/-y/direct)
- `config.ts` + `prompts.ts` → Find & load MCP configs, select servers
- `mcp-client.ts` → Establish server connections, handle OAuth auth
- `introspection.ts` → Fetch tools/resources/prompts schemas
- `codegen.ts` → Build TypeScript AST with types & client methods
- `generator.ts` → Coordinate pipeline, format code, handle errors
- Output → Write formatted TypeScript file with usage instructions

## Key Constraints

- Runtime: Always use Bun (not Node.js/NPM). Bun auto-loads .env files
- MCP SDK: OAuth/auth implementation in `node_modules/@modelcontextprotocol/sdk/dist/esm/client/auth.js`, `node_modules/@modelcontextprotocol/sdk/dist/esm/client/auth.d.ts`
- Generated Client: Must be tree-shakable for optimal bundle size
- Design Philosophy: Prioritize ideal design over backward compatibility

## Architecture Patterns

- Provider Pattern: OAuth providers (oauth-provider.ts)
- Factory Pattern: Dynamic client generation (generator.ts)
- Pipeline Pattern: Sequential processing (generator.ts workflow)
- Strategy Pattern: Multiple config formats (config.ts)
- Repository Pattern: OAuth storage interfaces (oauth-storage.ts)

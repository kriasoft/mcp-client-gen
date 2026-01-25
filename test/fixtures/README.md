# Test Fixtures

Test fixtures for MCP Client Generator.

## Structure

```text
fixtures/
├── notion/                    # Real server data
│   └── introspection.json     # Notion MCP capabilities
└── synthetic/                 # Minimal/edge-case schemas
    ├── server-capabilities.json
    └── oauth-metadata.json
```

## Real Server Data (`notion/`)

Captured from live Notion MCP server via `bun capture:notion`.

Use for deterministic unit tests that need realistic schema complexity.

## Synthetic Data (`synthetic/`)

Minimal schemas for edge cases and quick tests.

## Refreshing Fixtures

```bash
bun capture:notion --fixtures-only
```

## Usage

```typescript
import { readFileSync } from "fs";
import { resolve } from "path";

// Real Notion data
const notionFixture = JSON.parse(
  readFileSync(resolve(import.meta.dir, "notion/introspection.json"), "utf-8"),
);

// Synthetic data
const synthetic = JSON.parse(
  readFileSync(
    resolve(import.meta.dir, "synthetic/server-capabilities.json"),
    "utf-8",
  ),
);
```

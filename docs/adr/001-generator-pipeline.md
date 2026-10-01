# ADR-001 Generator Pipeline Architecture

**Status:** Accepted
**Date:** 2025-01-25 (revised 2026-10-01: one module per server, all or nothing)
**Tags:** codegen, pipeline, architecture

## Problem

- Introspection, code generation, formatting and file output must compose into a pipeline whose orchestrator stays thin and testable.
- Generating several servers into one file coupled them: names collided across servers, and a server failing (e.g. an auth outage) silently dropped its client from the file, changing the project's API on the next build.

## Decision

- `pipeline.ts` is a thin orchestrator for one server: introspect → generate AST → format. `generateClient(server)` returns the code; it writes nothing.
- Server names: explicit name > URL hostname > URL path segment > `server`.
- The CLI owns files. URL mode writes one file (or stdout). Config mode writes one module per server into a directory, all or nothing: every server is introspected first, and a single failure writes nothing and exits 1. Servers whose names map to the same file are rejected before connecting.
- Config servers are introspected one at a time: each may run a browser flow on the same loopback redirect port.

## Alternatives (brief)

- One file for all servers — cross-server name collisions (prefixed type names, rejected class names) and partial files.
- Partial success by default — an infrastructure failure would rewrite the project's TypeScript API; add `--allow-partial` if a real need appears.
- Parallel introspection — concurrent OAuth flows contend for the redirect port.

## Impact

- Positive: each module is self-contained; regenerating is safe to automate; no cross-server naming rules.
- Negative/Risks: config mode is as slow as the sum of its servers; one unreachable server blocks the rest until it is fixed or deselected.

## Links

- Code: `src/pipeline.ts`, `src/cli.ts`
- Related ADRs: ADR-003 (generated client contract)

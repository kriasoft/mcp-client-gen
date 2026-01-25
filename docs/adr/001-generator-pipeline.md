# ADR-001 Generator Pipeline Architecture

**Status:** Accepted
**Date:** 2025-01-25
**Tags:** codegen, pipeline, architecture

## Problem

- Need to wire together introspection, code generation, and file output into a cohesive pipeline while keeping the orchestrator thin and maintainable.

## Decision

- Create `pipeline.ts` as a thin orchestrator (~100 lines) that coordinates existing modules
- Pipeline flow: introspect (parallel) → separate successes/failures → generate AST → format (prettier) → write
- Extract server names with fallback strategy: explicit name > URL hostname > index
- Support partial success: generate client for successful servers, warn about failures
- All heavy lifting delegated to specialized modules (introspection.ts, codegen/)

## Alternatives (brief)

- Monolithic generator — rejected for maintainability; hard to test individual steps
- Sequential introspection — rejected for performance; parallel is faster for multiple servers
- Fail-fast on any server error — rejected for usability; partial results more useful

## Impact

- Positive: Clear separation of concerns, testable pipeline steps, graceful degradation
- Negative/Risks: Circular import potential between pipeline.ts and prompts.ts (mitigated by type-only imports)

## Links

- Code: `src/pipeline.ts`, `src/cli.ts`
- Related ADRs: None

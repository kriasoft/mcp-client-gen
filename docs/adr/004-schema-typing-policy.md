# ADR-004 JSON Schema Typing Policy

**Status:** Accepted  
**Date:** 2026-10-01 (records the policy shipped in 0.2.0, plus tuples and recursive refs)  
**Tags:** codegen, types

## Problem

- Tool input and output schemas are arbitrary JSON Schema; TypeScript can't express all of it (conditionals, patterns, numeric bounds, remote refs).
- A type stricter than the schema rejects calls the server accepts; a type that is too loose loses the point of generating one.
- Generated code must always compile, whatever a server publishes.

## Decision

- **Looser, never stricter.** Every generated type admits every value the schema accepts. Anything not modeled widens to `unknown`; unsupported keywords are ignored rather than approximated.
- **Two deliberate exceptions**, which keep typos in tool arguments visible:
  - an object without `additionalProperties` gets no index signature (JSON Schema allows extra keys), since an open signature on every object disables excess-property checks;
  - `properties` / `items` without `type` imply an object / array (JSON Schema applies them conditionally).
- **Whole-schema `type` aliases**, not interfaces: roots may be unions or dictionaries, and only aliases are assignable to the SDK's `Record<string, unknown>` arguments.
- **Local `$ref`s are inlined**, except targets that recur: those become named aliases (`{Type}{last pointer segment}`; a `$ref` to the root is the type itself). Cycles are detected by target identity.
- **Circularity is decided by the compiler.** Which recursions TypeScript defers is subtle, so when a schema recurses its aliases are compiled in memory (ts-morph). Each alias reported as circular (TS2456) is widened to `unknown`, one per pass.
- **Dialect:** a declared `$schema` picks the tuple keyword (`items` arrays up to 2019-09, `prefixItems` from 2020-12), and the other is ignored. Undeclared schemas accept both: MCP defaults to 2020-12, but servers often emit draft-07 output without declaring it. A resource declaring any other dialect (the SDK validates 2020-12, 2019-09, draft-07 and draft-06, matched exactly) is `unknown`: its keywords may mean something else (draft-04 has no `const`), and failing the whole server for one schema would be worse.
- **Remote `$ref`s are never fetched.**
- **A parameter defaults to `{}`** only when `{}` provably satisfies the input schema.

## Alternatives (brief)

- Exact JSON Schema semantics — every object would need an index signature, and typos would compile.
- Widen all recursion to `unknown` — recursive data (trees, nested filters) would lose its types.
- Name every `$defs` entry — larger output and diffs for no type-safety gain over inlining.
- A textual circularity heuristic — it missed real cases (mutual top-level references, recursive tuple rests).
- Resolve remote refs — turns generation into a network fetcher (SSRF, non-determinism).
- Fail generation on an unsupported dialect — one tool's schema would block a whole server's client; `unknown` is honest and still compiles.

## Impact

- Positive: valid calls always compile, and common mistakes don't; recursive schemas are typed; output compiles under `strict`.
- Negative/Risks: the circularity check runs on ts-morph's bundled TypeScript (6.x), the minimum generated code targets; newer compilers are assumed not to reject what it accepts. The two exceptions can reject extra keys a server would accept; the compiler check costs ~100–300 ms per recursive schema; conditional schemas (`if`/`then`) stay untyped.

## Links

- Code/Docs: `src/codegen/schema-to-typescript.ts`, `src/codegen/tool-input-generator.ts`, SPEC-generated-client (Type Generation)
- Related ADRs: ADR-003

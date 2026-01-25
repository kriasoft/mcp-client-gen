/**
 * Srcpack Configuration for MCP Client Generator
 *
 * This config bundles the codebase into LLM-optimized context files for use with
 * ChatGPT, Claude, Gemini, Grok, etc. Each bundle groups related files to provide
 * coherent context for specific tasks.
 *
 * Bundles:
 * - overview:   Project docs, config, and structure (start here for project understanding)
 * - core:       Core library: types, config loading, MCP client connection
 * - codegen:    Code generation: AST building, TypeScript file generation
 * - pipeline:   Generation pipeline: orchestration, introspection, schema handling
 * - cli:        CLI interface: argument parsing, interactive prompts
 * - tests:      All test files: unit tests, e2e tests, test utilities
 * - docs:       Documentation: ADRs, specs, implementation notes
 * - examples:   Example generated clients and usage patterns
 *
 * Usage:
 *   npx srcpack              # Generate all bundles to .srcpack/
 *   npx srcpack overview     # Generate specific bundle
 *   npx srcpack --dry-run    # Preview without writing
 *
 * @see https://github.com/kriasoft/srcpack
 */

import { config } from "dotenv";
import { defineConfig } from "srcpack";

config({ path: ".env.local", quiet: true });

export default defineConfig({
  bundles: {
    // Project overview: README, package.json, CLAUDE instructions, agents config
    // Use this bundle first to understand the project structure and goals
    overview: [
      "README.md",
      "package.json",
      "tsconfig.json",
      "+CLAUDE.md",
      "+CLAUDE.local.md",
      "+AGENTS.md",
      "+AGENTS.local.md",
    ],

    // Core library: entry point, types, config loading, MCP client
    // Essential modules for understanding how the library works
    core: [
      "src/index.ts",
      "src/types.ts",
      "src/config.ts",
      "src/mcp-client.ts",
      "src/utils.ts",
    ],

    // Code generation: TypeScript AST building, file generation
    // Modules responsible for generating the client code
    codegen: ["src/codegen/**/*.ts", "!src/codegen/**/*.test.ts"],

    // Generation pipeline: orchestration, introspection, schema handling
    // How the pieces fit together to generate a client
    pipeline: ["src/pipeline.ts", "src/introspection.ts"],

    // CLI interface: argument parsing, interactive prompts
    // User-facing command line experience
    cli: ["src/cli.ts", "src/prompts.ts"],

    // Unit and integration tests
    // Useful for understanding expected behavior and edge cases
    tests: [
      "src/**/*.test.ts",
      "test/e2e/**/*.ts",
      "test/manual/**/*.ts",
      "test/utils/**/*.ts",
      "test/fixtures/**/*.json",
      "test/fixtures/README.md",
    ],

    // Documentation: ADRs, specs, notes
    // Architecture decisions and implementation details
    docs: ["docs/**/*.md"],

    // Examples: generated clients and usage patterns
    // Reference implementations showing expected output
    examples: ["examples/**/*"],

    // Review bundle
    ...(process.env.SRCPACK_REVIEW && {
      review: {
        include: process.env.SRCPACK_REVIEW.split(","),
        prompt: process.env.SRCPACK_REVIEW_PROMPT || undefined,
      },
    }),
  },
});

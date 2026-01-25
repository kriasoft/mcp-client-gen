/**
 * Utility functions for code generation.
 *
 * String transformation utilities for consistent naming conventions.
 *
 * SPDX-FileCopyrightText: 2025-present Kriasoft
 * SPDX-License-Identifier: MIT
 */

// JS reserved words that need escaping when used as identifiers
const RESERVED = new Set([
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "export",
  "extends",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "new",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

/**
 * Convert string to PascalCase.
 * Produces valid TypeScript identifiers (prepends underscore if starts with digit).
 */
export function pascalCase(str: string): string {
  const result = str
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+(.)?/g, (_, char) => (char ? char.toUpperCase() : ""))
    .replace(/^(.)/, (char) => char.toUpperCase());

  if (!result) return "Unknown";
  if (/^[0-9]/.test(result)) return "_" + result;
  if (RESERVED.has(result.toLowerCase())) return "_" + result;
  return result;
}

/**
 * Convert string to camelCase.
 * Produces valid TypeScript identifiers (prepends underscore if starts with digit).
 */
export function camelCase(str: string): string {
  const result = str
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+(.)?/g, (_, char) => (char ? char.toUpperCase() : ""))
    .replace(/^(.)/, (char) => char.toLowerCase());

  if (!result) return "unknown";
  if (/^[0-9]/.test(result)) return "_" + result;
  if (RESERVED.has(result)) return "_" + result;
  return result;
}

/**
 * Utility functions for code generation.
 *
 * String transformation utilities for consistent naming conventions.
 *
 * SPDX-FileCopyrightText: 2025-present Kriasoft
 * SPDX-License-Identifier: MIT
 */

/**
 * Convert string to PascalCase.
 * Produces valid identifiers (prepends underscore if starts with digit). Reserved words
 * need no escaping: results only name types, classes and class members.
 */
export function pascalCase(str: string): string {
  const result = str
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+(.)?/g, (_, char) => (char ? char.toUpperCase() : ""))
    .replace(/^(.)/, (char) => char.toUpperCase());

  if (!result) return "Unknown";
  if (/^[0-9]/.test(result)) return "_" + result;
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
  return result;
}

/** Object key as written in TypeScript: bare when a valid identifier, else a string literal. */
export function propertyKey(name: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
}

/** Server-provided text made safe inside a comment: `*\/` would end it early. */
export function commentText(text: string): string {
  return text.replace(/\*\//g, "*\\/");
}

/** JSDoc block for server-provided text. */
export function docComment(text: string): string {
  const lines = commentText(text.trim()).split(/\r?\n/);
  return lines.length === 1
    ? `/** ${lines[0]} */`
    : `/**\n${lines.map((line) => ` * ${line}`.trimEnd()).join("\n")}\n */`;
}

/** `base`, or `base2`, `base3`, … — the first name not in `taken`, which it then joins. */
export function uniqueName(base: string, taken: Set<string>): string {
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}${n}`;
  taken.add(name);
  return name;
}

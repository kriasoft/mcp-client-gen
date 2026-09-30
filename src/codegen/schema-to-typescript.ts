/**
 * JSON Schema to TypeScript type conversion.
 *
 * Emits a type expression for a whole schema. Types may be looser than the schema, never
 * stricter: anything not expressible (tuples, recursive refs, remote refs) widens to
 * `unknown` rather than rejecting valid values.
 *
 * SPDX-FileCopyrightText: 2025-present Kriasoft
 * SPDX-License-Identifier: MIT
 */

import { docComment, propertyKey } from "./utils.js";

type Schema = boolean | Record<string, any> | null | undefined;

/**
 * Convert a JSON Schema to a TypeScript type expression.
 * @param root Document that local `$ref`s (`#/...`) resolve against; defaults to `schema`.
 */
export function jsonSchemaToTypeScript(schema: Schema, root = schema): string {
  return convert(schema, root, new Set());
}

function convert(schema: Schema, root: Schema, refs: Set<string>): string {
  if (schema === true || schema === undefined || schema === null)
    return "unknown";
  if (schema === false) return "never";
  if (typeof schema !== "object") return "unknown";
  // A nested $id starts a new resource: its `#/...` refs resolve within it
  if (typeof schema.$id === "string" && schema !== root) root = schema;

  if (typeof schema.$ref === "string") {
    const ref: string = schema.$ref;
    // Recursive or unresolvable: widen instead of emitting a named recursive type
    const target = refs.has(ref) ? undefined : resolveRef(root, ref);
    if (target === undefined) return "unknown";
    return convert(target, root, new Set(refs).add(ref));
  }

  if ("const" in schema) return literal(schema.const);
  if (Array.isArray(schema.enum))
    return union(schema.enum.map((value: unknown) => literal(value)));

  // Composition applies alongside sibling keywords (e.g. type + anyOf)
  const parts: string[] = [];
  const base = baseType(schema, root, refs);
  if (base !== undefined) parts.push(base);
  const alternatives = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(alternatives))
    parts.push(union(alternatives.map((s: Schema) => convert(s, root, refs))));
  if (Array.isArray(schema.allOf))
    parts.push(
      ...schema.allOf.map((s: Schema) => group(convert(s, root, refs))),
    );

  // `X & unknown` is just X
  const constraints = parts.filter((part) => part !== "unknown");
  if (constraints.length === 0) return "unknown";
  return constraints.length === 1
    ? constraints[0]!
    : constraints.map(group).join(" & ");
}

/** Type from `type` (and object/array keywords when `type` is omitted). */
function baseType(
  schema: Record<string, any>,
  root: Schema,
  refs: Set<string>,
): string | undefined {
  if (Array.isArray(schema.type)) {
    // Keep sibling keywords (items, properties, …) for every branch
    return union(
      schema.type.map(
        (type: string) =>
          baseType({ ...schema, type }, root, refs) ?? "unknown",
      ),
    );
  }
  switch (schema.type) {
    case "string":
      return "string";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "array":
      return arrayType(schema, root, refs);
    case "object":
      return objectType(schema, root, refs);
    case undefined:
      if (schema.properties || schema.additionalProperties !== undefined)
        return objectType(schema, root, refs);
      if (schema.items) return arrayType(schema, root, refs);
      return undefined;
    default:
      return "unknown";
  }
}

function arrayType(
  schema: Record<string, any>,
  root: Schema,
  refs: Set<string>,
): string {
  // Tuple forms (items: [...], prefixItems) aren't modeled: any element type
  if (Array.isArray(schema.items) || schema.prefixItems) return "unknown[]";
  return `${group(convert(schema.items, root, refs))}[]`;
}

function objectType(
  schema: Record<string, any>,
  root: Schema,
  refs: Set<string>,
): string {
  const properties: Record<string, Schema> = schema.properties ?? {};
  const required = new Set<string>(schema.required ?? []);
  const lines: string[] = [];
  const valueTypes: string[] = [];

  for (const [key, propSchema] of Object.entries(properties)) {
    const type = convert(propSchema, root, refs);
    const optional = !required.has(key);
    valueTypes.push(optional ? `${type} | undefined` : type);
    const doc =
      typeof propSchema === "object" && propSchema?.description
        ? docComment(propSchema.description) + "\n"
        : "";
    lines.push(`${doc}${propertyKey(key)}${optional ? "?" : ""}: ${type};`);
  }
  // Required names without a property schema still must be present
  for (const key of required) {
    if (key in properties) continue;
    valueTypes.push("unknown");
    lines.push(`${propertyKey(key)}: unknown;`);
  }

  // Keys beyond `properties`: additionalProperties and patternProperties (patterns
  // aren't modeled, so their value types join one string index signature)
  const additional = schema.additionalProperties;
  const patterns = Object.values(schema.patternProperties ?? {}) as Schema[];
  const extraTypes = [
    ...(additional !== undefined && additional !== false ? [additional] : []),
    ...patterns,
  ].map((s) => convert(s, root, refs));
  if (extraTypes.length > 0) {
    // The index signature must admit every declared property's type (TS2411)
    const indexType = union(extraTypes);
    const types = indexType === "unknown" ? [] : [indexType, ...valueTypes];
    lines.push(
      `[key: string]: ${types.length ? union(types.map(group)) : "unknown"};`,
    );
  } else if (lines.length === 0) {
    // No declared shape: JSON Schema objects are open by default
    return additional === false
      ? "Record<string, never>"
      : "Record<string, unknown>";
  }

  return `{\n${lines.join("\n")}\n}`;
}

/** Local JSON Pointer (`#`, `#/$defs/Id`) into `root`; anything else is unresolved. */
function resolveRef(root: Schema, ref: string): Schema {
  if (ref === "#") return root;
  if (!ref.startsWith("#/")) return undefined;
  let pointer: string;
  try {
    pointer = decodeURIComponent(ref.slice(2)); // URI-decode, then split (RFC 6901 §6)
  } catch {
    return undefined;
  }
  let node: any = root;
  for (const raw of pointer.split("/")) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (node === null || typeof node !== "object" || !(key in node))
      return undefined;
    node = node[key];
  }
  return node;
}

function literal(value: unknown): string {
  if (value === null) return "null";
  if (["string", "number", "boolean"].includes(typeof value))
    return JSON.stringify(value);
  return "unknown"; // object/array constants aren't modeled
}

function union(types: string[]): string {
  const unique = [...new Set(types)];
  if (unique.includes("unknown")) return "unknown";
  return unique.length ? unique.map(group).join(" | ") : "never";
}

/** Parenthesize unions/intersections so `[]`, `|` and `&` bind as intended. */
function group(type: string): string {
  return hasTopLevelOperator(type) ? `(${type})` : type;
}

/** `|` or `&` outside brackets, string literals and comments. */
function hasTopLevelOperator(type: string): boolean {
  let depth = 0;
  for (let i = 0; i < type.length; i++) {
    const char = type[i]!;
    if (char === '"') {
      // Skip a JSON string literal, honoring escapes
      for (i++; i < type.length && type[i] !== '"'; i++)
        if (type[i] === "\\") i++;
    } else if (char === "/" && type[i + 1] === "*") {
      i = type.indexOf("*/", i + 2);
      if (i < 0) return false;
      i++;
    } else if ("({[<".includes(char)) depth++;
    else if (")}]>".includes(char)) depth--;
    else if (depth === 0 && (char === "|" || char === "&")) return true;
  }
  return false;
}

/**
 * JSON Schema to TypeScript type conversion.
 *
 * Emits type expressions for whole schemas. Types may be looser than the schema, never
 * stricter: anything not expressible (remote refs, self-references TypeScript rejects as
 * circular) widens to `unknown` rather than rejecting valid values. Local `$ref`s are inlined, except those
 * that recurse: `schemaTypeAliases()` names their targets, `jsonSchemaToTypeScript()`
 * widens the cycle.
 *
 * SPDX-FileCopyrightText: 2025-present Kriasoft
 * SPDX-License-Identifier: MIT
 */

import { Project } from "ts-morph";
import { docComment, pascalCase, propertyKey, uniqueName } from "./utils.js";

type Schema = boolean | Record<string, any> | null | undefined;

export interface TypeAlias {
  name: string;
  type: string;
}

interface Context {
  /** `$ref` targets being expanded (the root first): meeting one again is recursion */
  expanding: Set<object>;
  /** Recursive targets and their alias names */
  named: Map<object, string>;
  /** Aliases for recursive targets other than the root */
  aliases: TypeAlias[];
  /** Alias name for a recursive target; absent: widen recursion to `unknown` */
  nameRef?: (ref: string, target: object) => string;
}

/** Convert a JSON Schema to a TypeScript type expression; recursion widens to `unknown`. */
export function jsonSchemaToTypeScript(schema: Schema): string {
  return convert(schema, schema, {
    expanding: new Set(),
    named: new Map(),
    aliases: [],
  });
}

/**
 * Type aliases for a schema: `name` first, then one per recursive `$ref` target, named
 * `{name}{pointer's last segment}` (a `$ref` to the root is `name` itself). Allocated
 * names join `taken`.
 */
export function schemaTypeAliases(
  schema: Schema,
  name: string,
  taken: Set<string>,
): TypeAlias[] {
  const ctx: Context = {
    expanding: new Set(isObject(schema) ? [schema] : []),
    named: new Map(),
    aliases: [],
    nameRef: (ref, target) =>
      target === schema
        ? name
        : uniqueName(name + pascalCase(ref.split("/").at(-1)!), taken),
  };
  const aliases = [
    { name, type: convert(schema, schema, ctx) },
    ...ctx.aliases,
  ];
  return ctx.named.size > 0 ? breakCircularAliases(aliases) : aliases;
}

/**
 * Widen aliases TypeScript rejects as circular (TS2456, e.g. `type A = A | string`, or
 * mutual top-level references) to `unknown`, asking the compiler: which recursions it
 * defers (object members, array elements, some tuple positions) is subtle.
 */
function breakCircularAliases(aliases: TypeAlias[]): TypeAlias[] {
  project ??= new Project({ useInMemoryFileSystem: true });
  for (;;) {
    const file = project.createSourceFile(
      "aliases.ts",
      aliases.map(({ name, type }) => `type ${name} = ${type};`).join("\n"),
      { overwrite: true },
    );
    // The diagnostic spans the alias name
    const circular = new Set(
      file
        .getPreEmitDiagnostics()
        .filter((d) => d.getCode() === CIRCULAR_ALIAS)
        .map((d) => file.getFullText().substr(d.getStart()!, d.getLength())),
    );
    // Widen one alias per pass: it may break a cycle the others are only part of
    const index = aliases.findIndex((alias) => circular.has(alias.name));
    if (index < 0) return aliases;
    aliases = aliases.with(index, { ...aliases[index]!, type: "unknown" });
  }
}

/** Reused: lib files parse once. */
let project: Project | undefined;

/** "Type alias '{0}' circularly references itself." */
const CIRCULAR_ALIAS = 2456;

function convert(schema: Schema, root: Schema, ctx: Context): string {
  if (schema === true || schema === undefined || schema === null)
    return "unknown";
  if (schema === false) return "never";
  if (typeof schema !== "object") return "unknown";
  // A nested $id starts a new resource: its `#/...` refs resolve within it
  if (typeof schema.$id === "string" && schema !== root) root = schema;

  if (typeof schema.$ref === "string") {
    const target = resolveRef(root, schema.$ref);
    if (!isObject(target)) return convert(target, root, ctx); // incl. unresolvable
    const known = ctx.named.get(target);
    if (known) return known;
    if (ctx.expanding.has(target)) {
      if (!ctx.nameRef) return "unknown";
      const name = ctx.nameRef(schema.$ref, target);
      ctx.named.set(target, name);
      return name;
    }
    ctx.expanding.add(target);
    const type = convert(target, root, ctx);
    ctx.expanding.delete(target);
    const name = ctx.named.get(target);
    if (!name) return type; // didn't recurse: inline
    ctx.aliases.push({ name, type });
    return name;
  }

  if ("const" in schema) return literal(schema.const);
  if (Array.isArray(schema.enum))
    return union(schema.enum.map((value: unknown) => literal(value)));

  // Composition applies alongside sibling keywords (e.g. type + anyOf)
  const parts: string[] = [];
  const base = baseType(schema, root, ctx);
  if (base !== undefined) parts.push(base);
  const alternatives = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(alternatives))
    parts.push(union(alternatives.map((s: Schema) => convert(s, root, ctx))));
  if (Array.isArray(schema.allOf))
    parts.push(
      ...schema.allOf.map((s: Schema) => group(convert(s, root, ctx))),
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
  ctx: Context,
): string | undefined {
  if (Array.isArray(schema.type)) {
    // Keep sibling keywords (items, properties, …) for every branch
    return union(
      schema.type.map(
        (type: string) => baseType({ ...schema, type }, root, ctx) ?? "unknown",
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
      return arrayType(schema, root, ctx);
    case "object":
      return objectType(schema, root, ctx);
    case undefined:
      if (schema.properties || schema.additionalProperties !== undefined)
        return objectType(schema, root, ctx);
      if (schema.items || schema.prefixItems)
        return arrayType(schema, root, ctx);
      return undefined;
    default:
      return "unknown";
  }
}

function arrayType(
  schema: Record<string, any>,
  root: Schema,
  ctx: Context,
): string {
  // Tuples: `prefixItems` + rest `items` (2020-12), or `items: [...]` + `additionalItems`
  const prefix = schema.prefixItems ?? schema.items;
  if (Array.isArray(prefix)) {
    const rest = Array.isArray(schema.items)
      ? schema.additionalItems
      : schema.items;
    return tupleType(prefix, rest, schema.minItems, root, ctx);
  }
  return `${group(convert(schema.items, root, ctx))}[]`;
}

/** Positions past `minItems` may be absent, so they are optional elements. */
function tupleType(
  prefix: Schema[],
  rest: Schema,
  minItems: unknown,
  root: Schema,
  ctx: Context,
): string {
  const required = typeof minItems === "number" ? minItems : 0;
  const elements = prefix.map((s, i) => {
    const type = convert(s, root, ctx);
    return i < required ? type : `${group(type)}?`;
  });
  if (rest !== false) elements.push(`...${group(convert(rest, root, ctx))}[]`);
  return `[${elements.join(", ")}]`;
}

function objectType(
  schema: Record<string, any>,
  root: Schema,
  ctx: Context,
): string {
  const properties: Record<string, Schema> = schema.properties ?? {};
  const required = new Set<string>(schema.required ?? []);
  const lines: string[] = [];
  const valueTypes: string[] = [];

  for (const [key, propSchema] of Object.entries(properties)) {
    const type = convert(propSchema, root, ctx);
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
  ].map((s) => convert(s, root, ctx));
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

function isObject(schema: unknown): schema is Record<string, any> {
  return typeof schema === "object" && schema !== null;
}

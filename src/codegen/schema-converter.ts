/**
 * JSON Schema to TypeScript type conversion utilities.
 *
 * Handles conversion of JSON Schema definitions to TypeScript type strings,
 * supporting all common schema types including objects, arrays, unions,
 * intersections, and enums.
 *
 * SPDX-FileCopyrightText: 2025-present Kriasoft
 * SPDX-License-Identifier: MIT
 */

/**
 * Convert JSON Schema to TypeScript type string
 */
export function jsonSchemaToTypeScript(schema: any): string {
  if (!schema) return "any";

  switch (schema.type) {
    case "string":
      if (schema.enum) {
        return schema.enum.map((v: string) => `"${v}"`).join(" | ");
      }
      return "string";

    case "number":
    case "integer":
      return "number";

    case "boolean":
      return "boolean";

    case "null":
      return "null";

    case "array":
      const itemType = jsonSchemaToTypeScript(schema.items);
      return `${itemType}[]`;

    case "object":
      if (!schema.properties) return "Record<string, any>";

      const props: string[] = [];
      const required = new Set(schema.required || []);

      for (const [key, propSchema] of Object.entries(schema.properties)) {
        const type = jsonSchemaToTypeScript(propSchema);
        const optional = required.has(key) ? "" : "?";
        const quotedKey = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)
          ? key
          : `"${key}"`;
        props.push(`  ${quotedKey}${optional}: ${type};`);
      }

      if (schema.additionalProperties) {
        const additionalType =
          schema.additionalProperties === true
            ? "any"
            : jsonSchemaToTypeScript(schema.additionalProperties);
        props.push(`  [key: string]: ${additionalType};`);
      }

      return props.length > 0 ? `{\n${props.join("\n")}\n}` : "{}";

    default:
      // Handle union types
      if (Array.isArray(schema.type)) {
        return schema.type
          .map((t: string) => jsonSchemaToTypeScript({ type: t }))
          .join(" | ");
      }

      // Handle anyOf/oneOf
      if (schema.anyOf || schema.oneOf) {
        const schemas = schema.anyOf || schema.oneOf;
        return schemas.map(jsonSchemaToTypeScript).join(" | ");
      }

      // Handle allOf (intersection)
      if (schema.allOf) {
        return schema.allOf.map(jsonSchemaToTypeScript).join(" & ");
      }

      return "any";
  }
}

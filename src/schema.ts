/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

interface McpToolSchema {
  type?: string;
  properties?: Record<string, any>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: any;
}

interface McpTool {
  name: string;
  description?: string;
  inputSchema: McpToolSchema;
}

export interface JsonSchemaType {
  type: "string" | "number" | "boolean" | "object" | "array" | "null";
  format?: string;
  properties?: Record<string, JsonSchemaType>;
  items?: JsonSchemaType;
  required?: string[];
  enum?: any[];
  const?: any;
  default?: any;
  description?: string;
  title?: string;
  examples?: any[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  additionalProperties?: boolean | JsonSchemaType;
  anyOf?: JsonSchemaType[];
  oneOf?: JsonSchemaType[];
  allOf?: JsonSchemaType[];
  not?: JsonSchemaType;
  $ref?: string;
}

export interface TypeScriptType {
  name: string;
  type: string;
  isOptional: boolean;
  description?: string;
  defaultValue?: any;
}

export interface ValidatedTool {
  name: string;
  description?: string;
  parameters: TypeScriptType[];
  returnType: string;
  inputSchema: McpToolSchema;
}

/**
 * JSON Schema to TypeScript type converter.
 * @pattern Visitor pattern for recursive schema traversal
 */
export class SchemaValidator {
  validateJsonSchema(schema: any): JsonSchemaType {
    if (!schema || typeof schema !== "object") {
      throw new Error("Schema must be a valid object");
    }

    // Minimal validation - rely on server-provided schemas
    if (!schema.type) {
      throw new Error("Schema must have a 'type' property");
    }

    const validTypes = [
      "string",
      "number",
      "boolean",
      "object",
      "array",
      "null",
    ];
    if (!validTypes.includes(schema.type)) {
      throw new Error(`Invalid schema type: ${schema.type}`);
    }

    return schema as JsonSchemaType;
  }

  validateMcpToolSchema(schema: McpToolSchema): JsonSchemaType {
    try {
      return this.validateJsonSchema(schema);
    } catch (error) {
      throw new Error(`Invalid MCP tool schema: ${(error as Error).message}`);
    }
  }

  validateTool(tool: McpTool): ValidatedTool {
    if (!tool.name || typeof tool.name !== "string") {
      throw new Error("Tool must have a valid name");
    }

    if (tool.name.trim() === "") {
      throw new Error("Tool name cannot be empty");
    }

    // Parse and validate tool's parameter schema
    const validatedSchema = this.validateMcpToolSchema(tool.inputSchema);

    // Transform JSON Schema properties to TS params
    const parameters = this.schemaToTypeScriptParameters(validatedSchema);

    return {
      name: tool.name,
      description: tool.description,
      parameters,
      returnType: "Promise<any>", // Tool results are protocol-defined JSON
      inputSchema: tool.inputSchema,
    };
  }

  private schemaToTypeScriptParameters(
    schema: JsonSchemaType,
  ): TypeScriptType[] {
    const parameters: TypeScriptType[] = [];

    if (schema.type === "object" && schema.properties) {
      const required = new Set(schema.required || []);

      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        const tsType = this.jsonSchemaToTypeScript(propSchema);
        const isOptional = !required.has(propName);

        parameters.push({
          name: propName,
          type: tsType,
          isOptional,
          description: propSchema.description,
          defaultValue: propSchema.default,
        });
      }
    }

    return parameters;
  }

  private jsonSchemaToTypeScript(schema: JsonSchemaType): string {
    switch (schema.type) {
      case "string":
        if (schema.enum) {
          return schema.enum.map((value) => `"${value}"`).join(" | ");
        }
        return "string";

      case "number":
        return "number";

      case "boolean":
        return "boolean";

      case "null":
        return "null";

      case "array":
        if (schema.items) {
          const itemType = this.jsonSchemaToTypeScript(schema.items);
          return `${itemType}[]`;
        }
        return "any[]";

      case "object":
        if (schema.properties) {
          const properties = Object.entries(schema.properties).map(
            ([key, propSchema]) => {
              const propType = this.jsonSchemaToTypeScript(propSchema);
              const isOptional = !(schema.required?.includes(key) ?? false);
              return `${key}${isOptional ? "?" : ""}: ${propType}`;
            },
          );
          return `{ ${properties.join("; ")} }`;
        }
        return "Record<string, any>";

      default:
        return "any";
    }
  }
}

/**
 * Generate TypeScript interfaces from MCP schemas.
 * @output Tree-shakable type definitions
 */
export class SchemaTransformer {
  private validator = new SchemaValidator();

  transformTools(tools: McpTool[]): ValidatedTool[] {
    return tools.map((tool) => this.validator.validateTool(tool));
  }

  generateTypeDefinitions(tools: ValidatedTool[]): string {
    const interfaces: string[] = [];
    const toolTypes: string[] = [];

    for (const tool of tools) {
      // One interface per tool for type safety
      if (tool.parameters.length > 0) {
        const interfaceName = `${this.capitalize(tool.name)}Parameters`;
        const properties = tool.parameters.map((param) => {
          const optional = param.isOptional ? "?" : "";
          const description = param.description
            ? `\n  /** ${param.description} */`
            : ""; // JSDoc for IDE hints
          return `${description}\n  ${param.name}${optional}: ${param.type};`;
        });

        interfaces.push(`
export interface ${interfaceName} {${properties.join("")}
}`);

        toolTypes.push(
          `${tool.name}: (params: ${interfaceName}) => ${tool.returnType}`,
        );
      } else {
        toolTypes.push(`${tool.name}: () => ${tool.returnType}`);
      }
    }

    const clientInterface = `
export interface GeneratedMcpClient {
${toolTypes.map((type) => `  ${type};`).join("\n")}
}`;

    return interfaces.join("\n") + "\n" + clientInterface;
  }

  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}

export const schemaValidator = new SchemaValidator();
export const schemaTransformer = new SchemaTransformer();

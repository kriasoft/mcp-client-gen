#!/usr/bin/env bun

/**
 * Captures Notion MCP server capabilities and optionally generates a client.
 *
 * Usage:
 *   bun capture:notion                  # Capture fixtures + generate example
 *   bun capture:notion --fixtures-only  # Capture fixtures only
 *   bun capture:notion --from-fixtures  # Regenerate example from saved fixtures (offline)
 *
 * Outputs:
 *   test/fixtures/notion/introspection.json  - Real Notion server data
 *   examples/notion-client.ts                - Generated TypeScript client
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { format as prettierFormat, resolveConfig } from "prettier";
import { generateClientFile } from "../../src/codegen";
import type { IntrospectionSuccess } from "../../src/introspection";
import { createMcpConnection } from "../../src/mcp-client";
import { formatTypeScript } from "../../src/pipeline";
import type { McpServerConfig } from "../../src/types";

// Parse CLI arguments
const fixturesOnly = process.argv.includes("--fixtures-only");
const fromFixtures = process.argv.includes("--from-fixtures");
const fixturePath = resolve(
  import.meta.dir,
  "../fixtures/notion/introspection.json",
);

console.log("Capturing Notion MCP Server Capabilities");
console.log(
  `   Mode: ${fromFixtures ? "example from saved fixtures" : fixturesOnly ? "fixtures only" : "fixtures + example"}`,
);
console.log("=".repeat(50));

const server: McpServerConfig = {
  name: "notion",
  type: "http",
  url: "https://mcp.notion.com/mcp",
};

async function captureCapabilities(): Promise<IntrospectionSuccess> {
  console.log("\nStep 1: Connecting to Notion MCP server...");
  console.log("   URL: https://mcp.notion.com/mcp");
  console.log("\n   The OAuth flow will:");
  console.log("   1. Open your browser for Notion authorization");
  console.log("   2. Start a callback server on http://127.0.0.1:3000");
  console.log("   3. Capture and exchange the authorization code");
  console.log("\n   Please complete the authorization in your browser...\n");

  const connection = await createMcpConnection(server, {
    oauth: {
      clientMetadata: { scope: "read:page:metadata read:database:metadata" },
      timeout: 120000,
    },
  });

  console.log("Connected successfully!");

  console.log("\nStep 2: Introspecting server capabilities...");
  console.log(`   Tools discovered: ${connection.tools.length}`);
  console.log(`   Resources discovered: ${connection.resources.length}`);
  console.log(`   Prompts discovered: ${connection.prompts.length}`);

  const result: IntrospectionSuccess = {
    ok: true,
    server,
    capabilities: connection.capabilities,
    tools: connection.tools,
    resources: connection.resources,
    prompts: connection.prompts,
  };

  await connection.client.close();

  return result;
}

async function generateClient(introspectionResult: IntrospectionSuccess) {
  console.log("\nStep 3: Generating TypeScript client...");

  const servers = new Map<string, IntrospectionSuccess>();
  servers.set("notion", introspectionResult);

  const { code: generatedCode } = generateClientFile(servers);

  console.log("   Client code generated successfully!");
  console.log(`   Total size: ${(generatedCode.length / 1024).toFixed(2)} KB`);

  const toolCount = introspectionResult.tools.length;
  const resourceCount = introspectionResult.resources.length;
  const promptCount = introspectionResult.prompts.length;

  console.log("\n   Generated client includes:");
  console.log(`   - ${toolCount} tool method(s)`);
  console.log(`   - ${resourceCount > 0 ? 1 : 0} resource method(s)`);
  console.log(`   - ${promptCount} prompt method(s)`);

  return generatedCode;
}

async function saveFixtures(introspectionResult: IntrospectionSuccess) {
  await mkdir(dirname(fixturePath), { recursive: true });

  const json = JSON.stringify(introspectionResult, null, 2);
  const prettierConfig = (await resolveConfig(fixturePath)) ?? {};
  const formatted = await prettierFormat(json, {
    ...prettierConfig,
    parser: "json",
  });
  await writeFile(fixturePath, formatted);
  console.log(`   Fixtures saved to: ${fixturePath}`);
}

async function saveExample(clientCode: string) {
  const projectRoot = resolve(import.meta.dir, "../..");
  const examplesDir = resolve(projectRoot, "examples");

  await mkdir(examplesDir, { recursive: true });

  const clientPath = resolve(examplesDir, "notion-client.ts");
  const formatted = await formatTypeScript(clientCode, clientPath);
  await writeFile(clientPath, formatted);
  console.log(`   Example saved to: ${clientPath}`);
}

async function runCapture() {
  if (fromFixtures) {
    const saved = JSON.parse(await readFile(fixturePath, "utf8"));
    await saveExample(await generateClient(saved));
    return;
  }
  try {
    const introspectionResult = await captureCapabilities();

    console.log("\nSaving outputs...");
    await saveFixtures(introspectionResult);

    if (!fixturesOnly) {
      const generatedCode = await generateClient(introspectionResult);
      await saveExample(generatedCode);
    }

    console.log("\nCapture completed successfully!");
    console.log("\nGenerated files:");
    console.log(
      "   test/fixtures/notion/introspection.json  - Server capabilities",
    );
    if (!fixturesOnly) {
      console.log(
        "   examples/notion-client.ts               - Generated client",
      );
    }

    console.log("=".repeat(50));
  } catch (error: any) {
    console.error("\nCapture failed!");
    console.error(`   Error: ${error.message}`);
    console.error(`   Type: ${error.constructor.name}`);

    if (error.stack) {
      console.error("\nStack Trace:");
      console.error(error.stack.split("\n").slice(1).join("\n"));
    }

    process.exit(1);
  }
}

runCapture();

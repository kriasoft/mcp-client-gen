#!/usr/bin/env bun

/**
 * Manual test script for generating a Notion MCP client.
 * This script:
 * 1. Authenticates with Notion via OAuth
 * 2. Introspects server capabilities
 * 3. Generates TypeScript client code
 * 4. Saves the client to ./examples/notion-generated.ts
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { generateClientFile } from "../../src/codegen";
import type { IntrospectionResult } from "../../src/introspection";
import { browserAuth, inMemoryStore } from "oauth-callback/mcp";
import type { McpServer } from "../../src/types";

console.log("🚀 Starting Notion MCP Client Generation");
console.log("=".repeat(50));

const store = inMemoryStore();

const authProvider = browserAuth({
  port: 3000,
  store,
  scope: "read:page:metadata read:database:metadata",
  openBrowser: true,
  authTimeout: 120000,
});

async function authenticateAndConnect() {
  console.log("\n📋 Step 1: Authenticating with Notion MCP server...");
  console.log("   URL: https://mcp.notion.com/mcp");
  console.log("\n⏳ The OAuth flow will:");
  console.log("   1. Open your browser for Notion authorization");
  console.log("   2. Start a callback server on http://localhost:3000");
  console.log("   3. Capture the authorization code after you approve");
  console.log("   4. Exchange the code for access tokens");
  console.log("\n🌐 Please complete the authorization in your browser...\n");

  const transport = new StreamableHTTPClientTransport(
    new URL("https://mcp.notion.com/mcp"),
    { authProvider },
  );

  const client = new Client(
    { name: "mcp-client-gen", version: "1.0.0" },
    { capabilities: {} },
  );

  try {
    await client.connect(transport);
  } catch (error: any) {
    if (error.constructor.name === "UnauthorizedError") {
      console.log("⏳ OAuth authorization in progress...");

      const pendingAuth = authProvider.getPendingAuthCode();
      if (pendingAuth?.code) {
        console.log("✅ Authorization code received!");
        console.log("🔄 Exchanging code for tokens...");

        await transport.finishAuth(pendingAuth.code);
        console.log("✅ Token exchange successful!");

        console.log("🔄 Creating new connection with authentication...");
        const authenticatedTransport = new StreamableHTTPClientTransport(
          new URL("https://mcp.notion.com/mcp"),
          { authProvider },
        );

        const authenticatedClient = new Client(
          { name: "mcp-client-gen", version: "1.0.0" },
          { capabilities: {} },
        );

        await authenticatedClient.connect(authenticatedTransport);

        try {
          await client.close();
        } catch {}

        return authenticatedClient;
      } else {
        console.error("❌ Failed to capture authorization code");
        throw error;
      }
    } else {
      throw error;
    }
  }

  return client;
}

async function introspectCapabilities(
  client: Client,
): Promise<IntrospectionResult> {
  console.log("\n📋 Step 2: Introspecting server capabilities...");

  const serverInfo = client.getServerVersion();
  const capabilities = client.getServerCapabilities();

  console.log("\n📊 Server Info:");
  console.log(`   Name: ${serverInfo?.name}`);
  console.log(`   Version: ${serverInfo?.version}`);

  let tools = { tools: [] as any[] };
  let resources = { resources: [] as any[] };
  let prompts = { prompts: [] as any[] };

  if (capabilities?.tools) {
    tools = await client.listTools();
    console.log(`\n🔧 Tools discovered: ${tools.tools.length}`);
  }

  if (capabilities?.resources) {
    resources = await client.listResources();
    console.log(`📚 Resources discovered: ${resources.resources.length}`);
  }

  if (capabilities?.prompts) {
    prompts = await client.listPrompts();
    console.log(`💬 Prompts discovered: ${prompts.prompts.length}`);
  }

  const server: McpServer = {
    name: "notion",
    type: "http",
    url: "https://mcp.notion.com/mcp",
  };

  return {
    server,
    capabilities,
    tools: tools.tools,
    resources: resources.resources,
    prompts: prompts.prompts,
  };
}

async function generateClient(introspectionResult: IntrospectionResult) {
  console.log("\n📋 Step 3: Generating TypeScript client...");

  const servers = new Map<string, IntrospectionResult>();
  servers.set("notion", introspectionResult);

  const generatedCode = generateClientFile(servers, {
    outputPath: "notion-generated.ts",
    includeComments: true,
    treeShakable: true,
  });

  console.log("✅ Client code generated successfully!");
  console.log(`   Total size: ${(generatedCode.length / 1024).toFixed(2)} KB`);

  const toolCount = introspectionResult.tools.length;
  const resourceCount = introspectionResult.resources.length;
  const promptCount = introspectionResult.prompts.length;

  console.log("\n📊 Generated client includes:");
  console.log(`   - ${toolCount} tool method(s)`);
  console.log(`   - ${resourceCount > 0 ? 1 : 0} resource method(s)`);
  console.log(`   - ${promptCount} prompt method(s)`);

  return generatedCode;
}

async function saveGeneratedFiles(
  clientCode: string,
  introspectionResult: IntrospectionResult,
) {
  console.log("\n📋 Step 4: Saving generated files...");

  const projectRoot = resolve(import.meta.dir, "../..");
  const examplesDir = resolve(projectRoot, "examples");

  await mkdir(examplesDir, { recursive: true });

  const clientPath = resolve(examplesDir, "notion-generated.ts");
  await writeFile(clientPath, clientCode);
  console.log(`✅ Client saved to: ${clientPath}`);

  const capabilitiesPath = resolve(examplesDir, "notion-capabilities.json");
  await writeFile(
    capabilitiesPath,
    JSON.stringify(introspectionResult, null, 2),
  );
  console.log(`✅ Capabilities saved to: ${capabilitiesPath}`);
}

async function runGeneration() {
  try {
    const client = await authenticateAndConnect();
    console.log("✅ Connected successfully!");

    const introspectionResult = await introspectCapabilities(client);

    const generatedCode = await generateClient(introspectionResult);

    await saveGeneratedFiles(generatedCode, introspectionResult);

    await client.close();

    console.log("\n🎉 Client generation completed successfully!");
    console.log("\n📁 Generated files:");
    console.log(
      "   ./examples/notion-generated.ts       - Generated client code",
    );
    console.log(
      "   ./examples/notion-capabilities.json  - Server capabilities",
    );

    console.log("\n💡 Next steps:");
    console.log(
      "   1. Review the generated client in ./examples/notion-generated.ts",
    );
    console.log("   2. Copy the files to your project");
    console.log("   3. Install dependencies: @modelcontextprotocol/sdk");
    console.log(
      "   4. Import and use the client (see examples/notion-usage.ts)",
    );

    console.log("=".repeat(50));
  } catch (error: any) {
    console.error("\n❌ Generation failed!");
    console.error(`   Error: ${error.message}`);
    console.error(`   Type: ${error.constructor.name}`);

    if (error.stack) {
      console.error("\n📋 Stack Trace:");
      console.error(error.stack.split("\n").slice(1).join("\n"));
    }

    process.exit(1);
  }
}

runGeneration();

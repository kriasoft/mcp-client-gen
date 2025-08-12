/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import {
  cancel,
  intro,
  isCancel,
  multiselect,
  outro,
  spinner,
  text,
} from "@clack/prompts";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { findMcpConfigFiles, getMcpServers } from "./config.js";
import type { McpServer } from "./types.js";

export interface PromptsResult {
  configFiles: string[];
  servers: McpServer[];
  outputFile: string;
}

export async function promptForConfigFiles(
  cwd: string = process.cwd(),
): Promise<string[]> {
  const availableFiles = await findMcpConfigFiles(cwd);

  if (availableFiles.length === 0) {
    throw new Error(
      "No MCP configuration files found. Create a .mcp.json file with your MCP server configuration.",
    );
  }

  const configSelection = await multiselect({
    message: "Select MCP configuration files to use:",
    options: availableFiles.map((file) => ({
      value: file,
      label: file.replace(cwd + "/", ""),
      hint: `Found at ${file}`,
    })),
    initialValues: availableFiles, // Select all by default
    required: true,
  });

  if (isCancel(configSelection)) {
    cancel("Operation cancelled");
    process.exit(0);
  }

  return configSelection as string[];
}

export async function promptForServers(
  configFiles: string[],
): Promise<McpServer[]> {
  const allServers = getMcpServers(configFiles);

  if (allServers.length === 0) {
    throw new Error(
      "No valid MCP servers found in configuration files. Check your .mcp.json configuration.",
    );
  }

  const serverSelection = await multiselect({
    message: "Select MCP servers to include:",
    options: allServers.map((server) => ({
      value: server,
      label: `${server.url}`,
      hint: `Type: ${server.type}`,
    })),
    initialValues: allServers, // Select all by default
    required: true,
  });

  if (isCancel(serverSelection)) {
    cancel("Operation cancelled");
    process.exit(0);
  }

  return serverSelection as McpServer[];
}

export async function promptForOutputFile(
  cwd: string = process.cwd(),
): Promise<string> {
  // Determine smart default based on project structure
  const srcExists = existsSync(resolve(cwd, "src"));
  const defaultPath = srcExists ? "src/lib/mcp-client.ts" : "lib/mcp-client.ts";

  const outputPath = await text({
    message: "Enter output file path:",
    placeholder: defaultPath,
    defaultValue: defaultPath,
    validate: (value) => {
      if (!value || value.trim() === "") {
        return "Output file path is required";
      }
      if (!value.endsWith(".ts")) {
        return "Output file must have .ts extension";
      }
      return undefined;
    },
  });

  if (isCancel(outputPath)) {
    cancel("Operation cancelled");
    process.exit(0);
  }

  return outputPath.trim();
}

export async function runInteractiveSetup(
  cwd: string = process.cwd(),
  useDefaults: boolean = false,
): Promise<PromptsResult> {
  if (useDefaults) {
    // Use defaults when -y flag is provided
    const configFiles = await findMcpConfigFiles(cwd);
    if (configFiles.length === 0) {
      throw new Error(
        "No MCP configuration files found. Create a .mcp.json file with your MCP server configuration.",
      );
    }

    const servers = getMcpServers(configFiles);
    if (servers.length === 0) {
      throw new Error(
        "No valid MCP servers found in configuration files. Check your .mcp.json configuration.",
      );
    }

    // Smart default for output file
    const srcExists = existsSync(resolve(cwd, "src"));
    const outputFile = srcExists
      ? "src/lib/mcp-client.ts"
      : "lib/mcp-client.ts";

    console.log(
      `🚀 Using defaults: ${servers.length} server${servers.length !== 1 ? "s" : ""} → ${outputFile}`,
    );

    return {
      configFiles,
      servers,
      outputFile,
    };
  }
  intro("🧩 MCP Client Generator");

  try {
    // Step 1: Select configuration files
    const configFiles = await promptForConfigFiles(cwd);

    // Step 2: Select servers from the chosen config files
    const servers = await promptForServers(configFiles);

    // Step 3: Specify output file
    const outputFile = await promptForOutputFile(cwd);

    outro(
      `🎉 Configuration complete! Generating client for ${servers.length} server${servers.length !== 1 ? "s" : ""}`,
    );

    return {
      configFiles,
      servers,
      outputFile,
    };
  } catch (error) {
    cancel(`Error: ${(error as Error).message}`);
    process.exit(1);
  }
}

export async function introspectServers(servers: McpServer[]) {
  const s = spinner();
  s.start(
    `Introspecting ${servers.length} MCP server${servers.length !== 1 ? "s" : ""}...`,
  );

  const results = [];

  for (const [index, server] of servers.entries()) {
    s.message(
      `[${index + 1}/${servers.length}] Connecting to ${server.url}...`,
    );
    // TODO: Replace with actual connection logic
    await new Promise((resolve) => setTimeout(resolve, 800));

    s.message(
      `[${index + 1}/${servers.length}] Fetching capabilities from ${server.url}...`,
    );
    // TODO: Replace with actual introspection logic
    await new Promise((resolve) => setTimeout(resolve, 600));

    // Fake result for now
    results.push({
      server,
      tools: Math.floor(Math.random() * 10) + 5,
      resources: Math.floor(Math.random() * 5),
      prompts: Math.floor(Math.random() * 3),
    });
  }

  const totalTools = results.reduce((sum, r) => sum + r.tools, 0);
  const totalResources = results.reduce((sum, r) => sum + r.resources, 0);
  const totalPrompts = results.reduce((sum, r) => sum + r.prompts, 0);

  s.stop(
    `✅ Successfully introspected ${servers.length} server${servers.length !== 1 ? "s" : ""}: ${totalTools} tools, ${totalResources} resources, ${totalPrompts} prompts`,
  );

  return results;
}

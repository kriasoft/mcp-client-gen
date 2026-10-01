/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * Capability discovery - snapshots a server's tools/resources/templates/prompts for codegen.
 *
 * Contract: introspectServer(server, options?) → Introspection
 * Invariant: Always closes its connection. Errors propagate unchanged (SDK error types
 * and causes intact); callers label them.
 */

import {
  ProtocolError,
  ProtocolErrorCode,
  UnauthorizedError,
  type ProtocolEra,
  type Prompt,
  type Resource,
  type ResourceTemplateType,
  type ServerCapabilities,
  type Tool,
} from "@modelcontextprotocol/client";
import { connectMcp } from "./mcp-client.js";
import type { GenerateClientOptions, McpServerConfig } from "./types.js";

/**
 * Browser flows one capability listing may complete. The last one only drains the flow
 * the failing request started (see withAuthorization), so it isn't retried.
 */
const MAX_AUTHORIZATIONS = 3;

/** What a server advertises: everything codegen needs. */
export interface Introspection {
  /** Negotiated protocol revision, e.g. `2026-07-28` */
  protocolVersion: string;
  /** Its era: wire shapes (e.g. non-object structured output) differ between eras */
  protocolEra: ProtocolEra;
  /** Server-advertised capabilities (empty object if none advertised) */
  capabilities: ServerCapabilities;
  tools: Tool[];
  resources: Resource[];
  resourceTemplates: ResourceTemplateType[];
  prompts: Prompt[];
  /** Whether requests carried OAuth tokens (callers likely need OAuth too) */
  authorized: boolean;
}

/** Connect, list capabilities, disconnect. */
export async function introspectServer(
  server: McpServerConfig,
  options?: GenerateClientOptions,
): Promise<Introspection> {
  const { client, requestOptions, completeAuthorization, authorized } =
    await connectMcp(server, options);

  // Every UnauthorizedError leaves a browser flow pending, and oauth-callback can't cancel
  // a connect()-owned one short of signing out (which would clear the store): complete it
  // (approval or timeout) so none outlives the connection. Bounded, since a server may
  // keep demanding scopes; the last completion drains rather than retries.
  const withAuthorization = async <T>(request: () => Promise<T>) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await request();
      } catch (error) {
        if (!completeAuthorization || !(error instanceof UnauthorizedError))
          throw error;
        await completeAuthorization();
        if (attempt === MAX_AUTHORIZATIONS) throw error;
      }
    }
  };

  try {
    // Sequential: OAuth refreshes on a caller-owned (SSE) transport must not overlap.
    // List calls without a cursor return every page.
    const capabilities = client.getServerCapabilities() ?? {};
    const tools = capabilities.tools
      ? (
          await withAuthorization(() =>
            client.listTools(undefined, requestOptions),
          )
        ).tools
      : [];
    const resources = capabilities.resources
      ? (
          await withAuthorization(() =>
            client.listResources(undefined, requestOptions),
          )
        ).resources
      : [];
    // Part of the resources capability, yet some servers don't implement it
    const resourceTemplates = capabilities.resources
      ? (
          await withAuthorization(() =>
            client
              .listResourceTemplates(undefined, requestOptions)
              .catch((error: unknown) => {
                if (
                  error instanceof ProtocolError &&
                  error.code === ProtocolErrorCode.MethodNotFound
                )
                  return { resourceTemplates: [] };
                throw error;
              }),
          )
        ).resourceTemplates
      : [];
    const prompts = capabilities.prompts
      ? (
          await withAuthorization(() =>
            client.listPrompts(undefined, requestOptions),
          )
        ).prompts
      : [];

    return {
      // Both are set once connected
      protocolVersion: client.getNegotiatedProtocolVersion()!,
      protocolEra: client.getProtocolEra()!,
      capabilities,
      tools,
      resources,
      resourceTemplates,
      prompts,
      authorized: await authorized(),
    };
  } finally {
    await client.close().catch(() => {}); // don't mask the cause
  }
}

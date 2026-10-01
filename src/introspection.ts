/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * Capability discovery - snapshots a server's tools/resources/templates/prompts for codegen.
 *
 * Contract: introspectServer(endpoint, options?) → ServerSnapshot
 * Invariant: Always attempts to close its connection. Errors propagate unchanged (SDK
 * error types and causes intact); callers label them. A close failure surfaces only
 * when nothing else failed.
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
import {
  connectMcp,
  type ConnectOptions,
  type McpEndpoint,
} from "./connect.js";

/**
 * Browser flows one introspection may trigger, across all its listings. The last one can't
 * rescue its listing, so it isn't retried (see withAuthorization).
 */
const MAX_AUTHORIZATIONS = 3;

/** What a server advertises, captured once: everything codegen needs. */
export interface ServerSnapshot {
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
  endpoint: McpEndpoint,
  options?: ConnectOptions,
): Promise<ServerSnapshot> {
  const { client, requestOptions, completeAuthorization, authorized } =
    await connectMcp(endpoint, options);

  // Every UnauthorizedError leaves a browser flow pending: complete it (approval, timeout
  // or abort), then retry. Bounded across all listings, since a server may keep demanding
  // scopes and each flow is a browser prompt. The last flow is left to the close, which
  // ends it over Streamable HTTP; an SSE transport's flow outlives its close, so it is
  // drained instead (no listener outlives introspection).
  let authorizations = 0;
  const withAuthorization = async <T>(request: () => Promise<T>) => {
    for (;;) {
      try {
        return await request();
      } catch (error) {
        if (!completeAuthorization || !(error instanceof UnauthorizedError))
          throw error;
        const last = ++authorizations === MAX_AUTHORIZATIONS;
        if (!last || endpoint.transport === "sse")
          await completeAuthorization();
        if (last) throw error;
      }
    }
  };

  let snapshot: ServerSnapshot;
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

    snapshot = {
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
  } catch (error) {
    await client.close().catch(() => {}); // don't mask the cause
    throw error;
  }
  // Nothing to mask: a failing close (e.g. a session DELETE) is worth knowing about
  await client.close();
  return snapshot;
}

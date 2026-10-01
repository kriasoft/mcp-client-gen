# Public API Specification

What `import … from "mcp-client-gen"` provides. Anything not listed here is internal (ADR-003). Code: `src/index.ts`, `src/pipeline.ts`, `src/connect.ts`.

## Exports

```typescript
function generateClientModule(
  endpoint: string | URL | McpEndpoint,
  options?: GenerateClientOptions,
): Promise<string>;

interface McpEndpoint {
  url: string | URL;
  transport?: "http" | "sse"; // default "http" (Streamable HTTP)
  headers?: RequestInit["headers"]; // any form fetch accepts
}

interface GenerateClientOptions {
  name?: string;
  oauth?: false | BrowserAuthOptions; // without serverUrl; redirectUri optional
  fetch?: typeof fetch;
  timeout?: number;
  signal?: AbortSignal;
}
```

## `generateClientModule()`

Introspects one server (SPEC-introspection), generates its module (SPEC-generated-client) and formats it with Prettier's defaults. It returns the source and writes nothing; the output doesn't depend on the working directory.

```typescript
const source = await generateClientModule("https://mcp.notion.com/mcp");

const github = await generateClientModule(
  { url, headers: { Authorization: `Bearer ${token}` } },
  { name: "github", oauth: false },
);
```

A string or `URL` endpoint is a Streamable HTTP server without extra headers.

## `McpEndpoint`

Describes the server, not the generated code.

| Field       | Meaning                                                                                              |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| `url`       | Server endpoint (`http:` or `https:`)                                                                |
| `transport` | `http`: Streamable HTTP, negotiating the newest protocol era; `sse`: legacy SSE                      |
| `headers`   | Sent only to the server's origin, never to OAuth endpoints elsewhere (e.g. a static `Authorization`) |

## `GenerateClientOptions`

`name` shapes the generated module; the rest apply while connecting and listing.

| Option    | Effect                                                                                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`    | Client name: `notion` → `createNotionClient`, `NotionClient`. Default: derived from the URL (SPEC-generated-client). Unrelated to the OAuth `clientName`                       |
| `oauth`   | oauth-callback `browserAuth()` options (ADR-002): `redirectUri` defaults to `http://127.0.0.1:3000/callback`; `false` never opens a browser, so a server demanding OAuth fails |
| `fetch`   | Custom fetch for every request (proxies, interceptors, tests)                                                                                                                  |
| `timeout` | Per request while connecting and listing (SDK default 60 s)                                                                                                                    |
| `signal`  | Aborts connecting, listing and a pending browser flow (except a step-up begun by listing, SPEC-introspection)                                                                  |

## Errors

Invalid input rejects before any request: a non-`http(s)` URL or an unknown `transport` with a `TypeError`, a `timeout` that isn't a positive number of milliseconds (up to 2³¹−1) with a `RangeError`. With `headers`, a redirect rejects too (they'd follow it to any origin): configure the final URL. Otherwise the promise rejects when the server can't be reached, authorized or listed. SDK errors (`UnauthorizedError`, `SdkHttpError`, …) pass through unchanged, causes intact. Invalid generator output or Prettier failures reject with `Failed to format generated code`.

## Not Public

Connecting, introspection, codegen, config discovery and formatting are internal, and there is no `/internal` entry (ADR-003). Generated modules never import this package. Widening this API means updating this spec first.

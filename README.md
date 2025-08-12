# MCP Client Generator

🚀 Generate type-safe TypeScript clients from any MCP (Model Context Protocol) server.

```typescript
import { notion, github, slack } from "./lib/mcp-client";

// Type-safe client calls with full IntelliSense
const page = await notion.createPage({
  title: "Meeting Notes",
  content: "Discussion about Q4 roadmap...",
});

const issue = await github.createIssue({
  title: "Bug: Login failure",
  body: "Users cannot authenticate...",
});

await slack.notify({
  channel: "#dev",
  message: `New issue created: ${issue.url}`,
});
```

## Features

✨ **Type-Safe** - Full TypeScript support with generated types  
🔄 **Multi-Provider** - Connect to multiple MCP servers simultaneously  
🎯 **Tree-Shakable** - Only bundle the methods you use  
⚡ **Fast** - Built with Bun for optimal performance  
🛠️ **Interactive CLI** - Smart prompts with sensible defaults  
⚙️ **Flexible** - Works with multiple MCP config formats

## Installation

```bash
npm install -g mcp-client-gen
# or use directly
npx mcp-client-gen
```

## Quick Start

### 1. Configure MCP Servers

Create a `.mcp.json` file with your MCP server endpoints:

```jsonc
{
  "mcpServers": {
    "notion": {
      "type": "http",
      "url": "https://mcp.notion.com/mcp",
    },
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/",
    },
  },
}
```

### 2. Generate Client SDK

**Interactive Mode (Recommended):**

```bash
npx mcp-client-gen    # Launch interactive prompts
npx mcp-client-gen -y # Accept all defaults and proceed
```

**Direct Mode:**

```bash
npx mcp-client-gen ./lib/mcp-client.ts
```

### 3. Use the Generated Client

```typescript
import { notion } from "./lib/mcp-client";

// All methods are fully typed based on the MCP server schema
const page = await notion.fetchPage("page-id");
const newPage = await notion.createPage({
  title: "My Page",
  content: "Page content...",
});
```

## CLI Reference

### Interactive Mode

```bash
npx mcp-client-gen              # Launch interactive prompts
npx mcp-client-gen -y           # Accept defaults and proceed
npx mcp-client-gen --yes        # Same as -y
```

### Direct Mode

```bash
npx mcp-client-gen [options] <output-file>

Arguments:
  output-file          Path for the generated client file

Options:
  --config <file>      MCP configuration file (default: auto-discover)
  -y, --yes            Accept all defaults and skip prompts
  --help              Show help information

Examples:
  npx mcp-client-gen                           # Interactive mode
  npx mcp-client-gen -y                        # Quick generation with defaults
  npx mcp-client-gen ./lib/mcp.ts              # Direct mode with output file
  npx mcp-client-gen --config custom.json ./src/clients.ts
```

## Use Cases

🔗 **API Integration** - Connect to multiple services with one SDK  
🤖 **Workflow Automation** - Build cross-platform automation scripts  
📊 **Data Synchronization** - Keep data in sync across different platforms  
🧪 **Rapid Prototyping** - Quickly test integrations with type safety

## Development Status

> **Preview Release** - This is an early preview. The core CLI and configuration parsing works, but MCP server introspection is still in development.

**Current Status:**

- ✅ CLI interface and configuration parsing
- ✅ Interactive prompts with smart defaults
- ✅ Multi-server client generation structure
- ✅ Multiple MCP config format support (.mcp.json, .cursor/, .vscode/)
- 🚧 MCP server schema introspection (in progress)
- 🚧 Real-time type generation from server capabilities
- 📋 Plugin system for custom transformations

**Coming Soon:**

- Full MCP protocol implementation
- Authentication handling
- Streaming support
- Error handling and retries

## Authentication

Generated MCP clients include built-in support for OAuth 2.1 authentication using RFC 7591 Dynamic Client Registration. The authentication flow is handled automatically:

### OAuth 2.1 Support

- **Dynamic Client Registration (RFC 7591)** - Clients automatically register with OAuth providers
- **PKCE Flow (RFC 7636)** - Secure authorization code exchange with Proof Key for Code Exchange
- **Multiple Auth Methods** - Supports `client_secret_basic`, `client_secret_post`, and public clients
- **Token Management** - Automatic token refresh and credential storage
- **Resource Protection** - RFC 9728 OAuth 2.0 Protected Resource Metadata support

### Authentication Flow

1. **Discovery** - Client discovers OAuth authorization server metadata
2. **Registration** - Dynamic client registration if credentials not found
3. **Authorization** - PKCE-based authorization code flow initiation
4. **Token Exchange** - Secure token exchange with automatic refresh
5. **API Calls** - Authenticated requests using Bearer tokens

### Configuration

Authentication is configured per MCP server in your `.mcp.json`:

```jsonc
{
  "mcpServers": {
    "secured-service": {
      "type": "http",
      "url": "https://api.example.com/mcp",
      "auth": {
        "type": "oauth",
        "clientId": "your-client-id", // Optional for dynamic registration
        "scopes": ["read", "write"],
      },
    },
  },
}
```

## Support & License

If this tool helps you build amazing integrations, consider [sponsoring the project](https://github.com/sponsors/koistya) to support continued development. 💖

---

**MIT Licensed** • Feel free to use this in your commercial projects, contribute back, or fork it entirely. Code should be free! 🔓

Built with ❤️ by [Konstantin Tarkus](https://github.com/koistya) and [contributors](https://github.com/kriasoft/mcp-client-gen/graphs/contributors).

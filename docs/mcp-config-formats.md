## Claude

<https://docs.anthropic.com/en/docs/claude-code/mcp>

```jsonc
{
  "mcpServers": {
    "api-server": {
      "type": "sse",
      "url": "${API_BASE_URL:-https://api.example.com}/mcp",
      "headers": {
        "Authorization": "Bearer ${API_KEY}",
      },
    },
  },
}
```

## Cursor

<https://docs.cursor.com/en/context/mcp>

```jsonc
// MCP server using HTTP or SSE - runs on a server
{
  "mcpServers": {
    "server-name": {
      "url": "http://localhost:3000/mcp",
      "headers": {
        "API_KEY": "value",
      },
    },
  },
}
```

## VSCode

<https://code.visualstudio.com/docs/copilot/chat/mcp-servers>

```jsonc
{
  // 💡 Inputs are prompted on first server start, then stored securely by VS Code.
  "inputs": [
    {
      "type": "promptString",
      "id": "perplexity-key",
      "description": "Perplexity API Key",
      "password": true,
    },
  ],
  "servers": {
    // https://github.com/github/github-mcp-server/
    "Github": {
      "url": "https://api.githubcopilot.com/mcp/",
    },
    // https://github.com/ppl-ai/modelcontextprotocol/
    "Perplexity": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "server-perplexity-ask"],
      "env": {
        "PERPLEXITY_API_KEY": "${input:perplexity-key}",
      },
    },
  },
}
```

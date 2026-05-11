# LeanIX MCP Server (JavaScript/TypeScript)

MCP server for LeanIX Enterprise Architecture with OAuth support, serving over Streamable HTTP.

## Tools

| Tool | Purpose |
|------|---------|
| `get_metamodel_summary` | Returns workspace metamodel (fact sheet types, fields, relations) in compact CSV format. **Call this first in every session.** |
| `graphql_query` | Execute read-only GraphQL queries (search, get, list) |
| `graphql_mutation` | Execute GraphQL mutations (create, update, delete) |

## Setup

```bash
# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env
# Edit .env with your LeanIX credentials

# Run in development
npm run dev

# Build and run production
npm run build
npm start
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LEANIX_BASE_URL` | No | `https://app.leanix.net` | LeanIX instance URL |
| `LEANIX_WORKSPACE_ID` | Yes | — | Workspace ID |
| `LEANIX_API_TOKEN` | Yes* | — | API token (alternative to client_id/secret) |
| `LEANIX_CLIENT_ID` | Yes* | — | OAuth2 client ID |
| `LEANIX_CLIENT_SECRET` | Yes* | — | OAuth2 client secret |
| `MCP_PORT` | No | `3000` | MCP server port |
| `MCP_AUTH_PORT` | No | `3001` | OAuth authorization server port |
| `MCP_OAUTH_ENABLED` | No | `true` | Enable MCP-level OAuth |

\* Provide either `LEANIX_API_TOKEN` or both `LEANIX_CLIENT_ID` + `LEANIX_CLIENT_SECRET`.

## Architecture

```
Client (Claude, etc.)
    │
    │  MCP over Streamable HTTP (POST/GET/DELETE /mcp)
    │  + OAuth2 bearer token (when MCP_OAUTH_ENABLED=true)
    │
    ▼
┌─────────────────────────────────────────┐
│  Express App (port 3000)                │
│  ├── OAuth middleware (bearer auth)     │
│  ├── Session management                 │
│  └── StreamableHTTPServerTransport      │
│       └── McpServer                     │
│            ├── get_metamodel_summary    │
│            ├── graphql_query            │
│            └── graphql_mutation         │
└─────────────────────────────────────────┘
    │
    │  LeanIX API (client_credentials OAuth2)
    │  POST /services/pathfinder/v1/graphql
    │  GET  /services/pathfinder/v1/metaModel
    ▼
┌─────────────────────────────────────────┐
│  LeanIX Cloud                           │
└─────────────────────────────────────────┘
```

## OAuth

When `MCP_OAUTH_ENABLED=true` (default), the server requires MCP clients to authenticate via OAuth2 before calling tools. The included OAuth provider is a **demo/reference implementation** (in-memory, auto-approves). For production, replace with your real identity provider.

To disable OAuth (e.g., for local development):
```
MCP_OAUTH_ENABLED=false
```

## MCP Client Configuration

Add to your MCP client config (e.g., Claude Desktop `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "leanix": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

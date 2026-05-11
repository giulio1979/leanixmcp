# LeanIX MCP Server (JavaScript/TypeScript)

MCP server for LeanIX Enterprise Architecture, serving over Streamable HTTP.

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

\* Provide either `LEANIX_API_TOKEN` or both `LEANIX_CLIENT_ID` + `LEANIX_CLIENT_SECRET`.

## Architecture

```
Client (Claude, etc.)
    │
    │  MCP over Streamable HTTP (POST/GET/DELETE /mcp)
    │
    ▼
┌─────────────────────────────────────────┐
│  Express App (port 3000)                │
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

## MCP Client Configuration

### Streamable HTTP (remote / shared)

Start the server (`npm start` or `npm run dev`), then point your MCP client at it:

```json
{
  "mcpServers": {
    "leanix": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

### stdio (local / spawned by client)

The client spawns the server as a child process — no network required:

```json
{
  "mcpServers": {
    "leanix": {
      "command": "node",
      "args": ["dist/stdio.js"],
      "cwd": "/path/to/leanixmcp",
      "env": {
        "LEANIX_WORKSPACE_ID": "your-workspace-id",
        "LEANIX_API_TOKEN": "your-api-token"
      }
    }
  }
}
```

Or if installed globally / via `npx`:

```json
{
  "mcpServers": {
    "leanix": {
      "command": "npx",
      "args": ["leanix-mcp-tiny-server"],
      "env": {
        "LEANIX_WORKSPACE_ID": "your-workspace-id",
        "LEANIX_API_TOKEN": "your-api-token"
      }
    }
  }
}
```

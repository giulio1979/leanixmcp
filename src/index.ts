#!/usr/bin/env node
/**
 * LeanIX MCP Server — Entry Point
 *
 * Wires Express app with:
 *   - Streamable HTTP transport for MCP
 *   - Optional MCP-level OAuth (via SDK auth helpers)
 *   - Session management
 *   - Graceful shutdown
 */

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import express, { Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { LeanIXClient, loadConfig } from './leanix-client.js';
import { createMcpServer } from './server.js';
import { DemoOAuthProvider } from './oauth-provider.js';

// ─── Configuration ──────────────────────────────────────────────────────────────

const MCP_PORT = parseInt(process.env.MCP_PORT || '3000', 10);
const MCP_AUTH_PORT = parseInt(process.env.MCP_AUTH_PORT || '3001', 10);
const oauthEnabled = (process.env.MCP_OAUTH_ENABLED || 'true').toLowerCase() !== 'false';

// ─── LeanIX Client (singleton) ──────────────────────────────────────────────────

const leanixConfig = loadConfig();
const leanixClient = new LeanIXClient(leanixConfig);

// ─── Express App ────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// ─── OAuth Setup ────────────────────────────────────────────────────────────────

let authMiddleware: express.RequestHandler | null = null;

if (oauthEnabled) {
  const provider = new DemoOAuthProvider();
  const authServerUrl = new URL(`http://localhost:${MCP_AUTH_PORT}`);

  // Start separate OAuth authorization server
  const authApp = express();
  authApp.use(express.json());
  authApp.use(express.urlencoded({ extended: true }));
  authApp.use(
    mcpAuthRouter({
      provider,
      issuerUrl: authServerUrl,
      scopesSupported: ['mcp:tools'],
    })
  );

  authApp.listen(MCP_AUTH_PORT, () => {
    console.log(`OAuth Authorization Server listening on port ${MCP_AUTH_PORT}`);
  });

  // Bearer auth middleware for MCP endpoints
  authMiddleware = requireBearerAuth({ verifier: provider });
}

// ─── Session Management ─────────────────────────────────────────────────────────

const transports: Record<string, StreamableHTTPServerTransport> = {};

// ─── MCP Handlers ───────────────────────────────────────────────────────────────

const mcpPostHandler = async (req: Request, res: Response): Promise<void> => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  try {
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports[sessionId]) {
      // Reuse existing transport
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      // New session
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid: string) => {
          transports[sid] = transport;
          console.log(`Session initialized: ${sid}`);
        },
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && transports[sid]) {
          delete transports[sid];
          console.log(`Session closed: ${sid}`);
        }
      };

      // Connect MCP server to this transport
      const mcpServer = createMcpServer(leanixClient);
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    } else {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('Error handling MCP request:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
};

const mcpGetHandler = async (req: Request, res: Response): Promise<void> => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }
  const transport = transports[sessionId];
  await transport.handleRequest(req, res);
};

const mcpDeleteHandler = async (req: Request, res: Response): Promise<void> => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }
  const transport = transports[sessionId];
  await transport.handleRequest(req, res);
};

// ─── Route Registration ─────────────────────────────────────────────────────────

if (authMiddleware) {
  app.post('/mcp', authMiddleware, mcpPostHandler);
  app.get('/mcp', authMiddleware, mcpGetHandler);
  app.delete('/mcp', authMiddleware, mcpDeleteHandler);
} else {
  app.post('/mcp', mcpPostHandler);
  app.get('/mcp', mcpGetHandler);
  app.delete('/mcp', mcpDeleteHandler);
}

// Health check (unauthenticated)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', oauth: oauthEnabled });
});

// ─── Start Server ───────────────────────────────────────────────────────────────

app.listen(MCP_PORT, () => {
  console.log(`LeanIX MCP Server listening on port ${MCP_PORT}`);
  console.log(`  Transport: Streamable HTTP`);
  console.log(`  OAuth: ${oauthEnabled ? 'enabled' : 'disabled'}`);
  console.log(`  Endpoint: http://localhost:${MCP_PORT}/mcp`);
  if (oauthEnabled) {
    console.log(`  Auth server: http://localhost:${MCP_AUTH_PORT}`);
  }
});

// ─── Graceful Shutdown ──────────────────────────────────────────────────────────

process.on('SIGINT', async () => {
  console.log('Shutting down...');
  for (const sessionId of Object.keys(transports)) {
    try {
      await transports[sessionId].close();
      delete transports[sessionId];
    } catch (err) {
      console.error(`Error closing session ${sessionId}:`, err);
    }
  }
  process.exit(0);
});

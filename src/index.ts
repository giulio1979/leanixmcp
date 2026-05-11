#!/usr/bin/env node
/**
 * LeanIX MCP Server — Entry Point
 *
 * Wires Express app with:
 *   - Streamable HTTP transport for MCP
 *   - Session management
 *   - Graceful shutdown
 */

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import express, { Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { LeanIXClient, loadConfig } from './leanix-client.js';
import { createMcpServer } from './server.js';

// ─── Configuration ──────────────────────────────────────────────────────────────

const MCP_PORT = parseInt(process.env.MCP_PORT || '3000', 10);

// ─── LeanIX Client (singleton) ──────────────────────────────────────────────────

const leanixConfig = loadConfig();
const leanixClient = new LeanIXClient(leanixConfig);

// ─── Express App ────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

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

app.post('/mcp', mcpPostHandler);
app.get('/mcp', mcpGetHandler);
app.delete('/mcp', mcpDeleteHandler);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// ─── Start Server ───────────────────────────────────────────────────────────────

app.listen(MCP_PORT, () => {
  console.log(`LeanIX MCP Server listening on port ${MCP_PORT}`);
  console.log(`  Transport: Streamable HTTP`);
  console.log(`  Endpoint: http://localhost:${MCP_PORT}/mcp`);
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

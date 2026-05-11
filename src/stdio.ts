#!/usr/bin/env node
/**
 * LeanIX MCP Server — stdio transport entry point
 *
 * Runs the MCP server over stdin/stdout using JSON-RPC.
 * Use this for local integrations where the MCP client spawns the server as a child process.
 */

import 'dotenv/config';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { LeanIXClient, loadConfig } from './leanix-client.js';
import { createMcpServer } from './server.js';

const leanixClient = new LeanIXClient(loadConfig());
const server = createMcpServer(leanixClient);

const transport = new StdioServerTransport();
await server.connect(transport);

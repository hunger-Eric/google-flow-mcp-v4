#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';
import { TOOLS, handleTool } from './tools.js';

dotenv.config();

// ─── MCP Server ───────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'google-flow-mcp', version: '4.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    return await handleTool(name, args ?? {});
  } catch (err: any) {
    return {
      content: [{ type: 'text', text: `❌ ${name} failed: ${err.message}` }],
      isError: true,
    };
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[google-flow-mcp] v4.0.0 ready on stdio');

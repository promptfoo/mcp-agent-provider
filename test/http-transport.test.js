import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import MCPClient from '../src/mcp-client.js';

test('MCP client initializes and calls a tool through the real HTTP adapter', {
  timeout: 15_000,
}, async (t) => {
  const sdk = new Server(
    { name: 'local-http-fixture', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );
  sdk.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'echo',
        description: 'Return a local fixture message',
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
        },
      },
    ],
  }));
  sdk.setRequestHandler(CallToolRequestSchema, async ({ params }) => ({
    content: [{ type: 'text', text: params.arguments.text }],
  }));
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: randomUUID,
    enableJsonResponse: true,
  });
  const serverErrors = [];
  const http = createServer((req, res) => {
    if (req.url !== '/mcp') {
      res.writeHead(404).end();
      return;
    }
    transport.handleRequest(req, res).catch((error) => {
      serverErrors.push(error);
      res.writeHead(500).end('Local fixture failed');
    });
  });
  let client;
  t.after(async () => {
    await client?.client?.close();
    await client?.transport?.close();
    await sdk.close();
    http.closeAllConnections();
    await new Promise((resolve) => http.close(resolve));
  });
  await sdk.connect(transport);
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  const base = `http://127.0.0.1:${http.address().port}`;
  client = new MCPClient({ url: `${base}/mcp` });

  assert.equal(await client.connect(), true);
  assert.equal(client.isConnected, true);
  assert.deepEqual(
    (await client.listTools()).map((tool) => tool.name),
    ['echo'],
  );
  assert.equal(
    await client.callTool('echo', { text: 'Hello local fixture' }),
    'Hello local fixture',
  );
  await client.client.ping();
  await assert.rejects(client.callTool('not-listed', {}), /not found/);
  assert.equal((await fetch(`${base}/missing`)).status, 404);
  assert.equal(
    await client.callTool('echo', { text: 'Still available' }),
    'Still available',
  );
  assert.deepEqual(serverErrors, []);
});

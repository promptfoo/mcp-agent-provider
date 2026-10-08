import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import MCPClient from '../src/mcp-client.js';

for (const serverKind of ['HTTP adapter', 'SDK Express JSON middleware']) {
  test(`MCP client initializes and calls a tool through the ${serverKind}`, {
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
    const handleRequest = (req, res) => {
      if (req.url !== '/mcp') {
        res.writeHead(404).end();
        return;
      }
      transport.handleRequest(req, res, req.body).catch((error) => {
        serverErrors.push(error);
        res.writeHead(500).end('Local fixture failed');
      });
    };
    const app =
      serverKind === 'SDK Express JSON middleware'
        ? createMcpExpressApp()
        : undefined;
    app?.use(handleRequest);
    const http = createServer(app ?? handleRequest);
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
      await client.callTool('echo', { text: 'Hello local fixture — café' }),
      'Hello local fixture — café',
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
}

test('MCP client falls back to legacy SSE after a Streamable HTTP 4xx', {
  timeout: 15_000,
}, async (t) => {
  const app = createMcpExpressApp();
  const sessions = new Map();
  const authenticatedRequests = [];

  app.use((req, res, next) => {
    if (
      req.headers.authorization !== 'Bearer local-fixture-token' ||
      req.headers['x-fixture-header'] !== 'preserved'
    ) {
      res.status(401).send('Missing fixture authentication');
      return;
    }
    authenticatedRequests.push(`${req.method} ${req.path}`);
    next();
  });

  app.get('/sse', async (_req, res) => {
    const sdk = new Server(
      { name: 'legacy-sse-fixture', version: '1.0.0' },
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

    const transport = new SSEServerTransport('/messages', res);
    sessions.set(transport.sessionId, { sdk, transport });
    res.on('close', () => {
      sessions.delete(transport.sessionId);
      void sdk.close();
    });
    await sdk.connect(transport);
  });

  app.post('/messages', async (req, res) => {
    const sessionId = String(req.query.sessionId ?? '');
    const session = sessions.get(sessionId);
    if (!session) {
      res.status(400).send('Unknown SSE session');
      return;
    }
    await session.transport.handlePostMessage(req, res, req.body);
  });

  const http = createServer(app);
  let client;
  t.after(async () => {
    await client?.client?.close();
    await client?.transport?.close();
    for (const { sdk, transport } of sessions.values()) {
      await transport.close();
      await sdk.close();
    }
    http.closeAllConnections();
    await new Promise((resolve) => http.close(resolve));
  });

  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  const base = `http://127.0.0.1:${http.address().port}`;
  client = new MCPClient({
    url: `${base}/sse`,
    auth: { type: 'bearer', token: 'local-fixture-token' },
    headers: { 'x-fixture-header': 'preserved' },
  });

  assert.equal(await client.connect(), true);
  assert.equal(client.isConnected, true);
  assert.deepEqual(
    (await client.listTools()).map((tool) => tool.name),
    ['echo'],
  );
  assert.equal(
    await client.callTool('echo', { text: 'legacy transport' }),
    'legacy transport',
  );
  assert.ok(authenticatedRequests.includes('POST /sse'));
  assert.ok(authenticatedRequests.includes('GET /sse'));
  assert.ok(authenticatedRequests.includes('POST /messages'));
});

test('MCP client does not fall back to SSE for server errors', async (t) => {
  const requests = [];
  const http = createServer((req, res) => {
    requests.push(req.method);
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('fixture server unavailable');
  });
  let client;
  t.after(async () => {
    await client?.client?.close();
    await client?.transport?.close();
    http.closeAllConnections();
    await new Promise((resolve) => http.close(resolve));
  });
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  client = new MCPClient({
    url: `http://127.0.0.1:${http.address().port}/mcp`,
  });

  await assert.rejects(client.connect(), /fixture server unavailable/);
  assert.equal(client.isConnected, false);
  assert.deepEqual(requests, ['POST']);
});

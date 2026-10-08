import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test } from 'node:test';

import OpenAIAgentProvider from '../src/openai-agent-provider.js';

for (const [name, usage, expected] of [
  [
    'measured usage without an explicit total',
    { prompt_tokens: 10, completion_tokens: 2 },
    { prompt: 10, completion: 2, total: 12, numRequests: 1 },
  ],
  [
    'zero measured usage',
    { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    { prompt: 0, completion: 0, total: 0, numRequests: 1 },
  ],
  ['missing usage', undefined, undefined],
]) {
  test(`provider preserves ${name} through the real SDK`, async (t) => {
    const requests = [];
    const server = createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      requests.push({
        path: request.url,
        body: JSON.parse(Buffer.concat(chunks).toString()),
      });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          id: 'local-completion',
          object: 'chat.completion',
          created: 0,
          model: 'local-fixture',
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: { role: 'assistant', content: 'Measured response' },
            },
          ],
          usage,
        }),
      );
    });
    t.after(async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');

    const provider = new OpenAIAgentProvider({
      config: {
        apiKey: 'local-fixture-key',
        apiBaseUrl: `http://127.0.0.1:${server.address().port}/v1`,
        model: 'local-fixture',
      },
    });
    t.after(() => provider.cleanup());
    const result = await provider.callApi('Hello {{name}}', {
      vars: { name: 'reader' },
    });

    assert.equal(result.error, undefined);
    assert.match(result.output, /^Measured response/);
    assert.deepEqual(result.tokenUsage, expected);
    assert.equal('cost' in result, false);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].path, '/v1/chat/completions');
    assert.equal(requests[0].body.messages.at(-1).content, 'Hello reader');
  });
}

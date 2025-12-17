const { test, describe } = require("node:test");
const assert = require("node:assert");

const MCPClient = require("../src/mcp-client");
const ReactAgent = require("../src/react-agent");
const OpenAIAgentProvider = require("../src/openai-agent-provider");

describe("MCPClient", () => {
  test("can be instantiated with empty config", () => {
    const client = new MCPClient();
    assert.strictEqual(client.isConnected, false);
    assert.deepStrictEqual(client.tools, []);
  });

  test("can be instantiated with config", () => {
    const client = new MCPClient({
      url: "http://localhost:3000",
      name: "test-server",
    });
    assert.strictEqual(client.isConnected, false);
    assert.strictEqual(client.getServerName(), "test-server");
  });

  test("getServerName returns correct values", () => {
    assert.strictEqual(
      new MCPClient({ name: "custom" }).getServerName(),
      "custom"
    );
    assert.strictEqual(
      new MCPClient({ url: "http://example.com" }).getServerName(),
      "http://example.com"
    );
    assert.strictEqual(
      new MCPClient({ path: "/path/to/server.js" }).getServerName(),
      "/path/to/server.js"
    );
    assert.strictEqual(
      new MCPClient({ command: "node" }).getServerName(),
      "node"
    );
    assert.strictEqual(new MCPClient({}).getServerName(), "default");
  });

  test("getAuthHeaders returns correct headers for bearer token", () => {
    const client = new MCPClient({
      auth: { type: "bearer", token: "test-token" },
    });
    const headers = client.getAuthHeaders();
    assert.deepStrictEqual(headers, { Authorization: "Bearer test-token" });
  });

  test("getAuthHeaders returns correct headers for api_key", () => {
    const client = new MCPClient({
      auth: { type: "api_key", api_key: "my-api-key" },
    });
    const headers = client.getAuthHeaders();
    assert.deepStrictEqual(headers, { "X-API-Key": "my-api-key" });
  });

  test("getAuthHeaders returns correct headers for basic auth", () => {
    const client = new MCPClient({
      auth: { type: "basic", username: "user", password: "pass" },
    });
    const headers = client.getAuthHeaders();
    const expectedAuth = Buffer.from("user:pass").toString("base64");
    assert.deepStrictEqual(headers, { Authorization: `Basic ${expectedAuth}` });
  });

  test("getAuthHeaders returns empty object when no auth", () => {
    const client = new MCPClient({});
    const headers = client.getAuthHeaders();
    assert.deepStrictEqual(headers, {});
  });

  test("listTools throws when not connected", async () => {
    const client = new MCPClient();
    await assert.rejects(
      async () => client.listTools(),
      /Not connected to MCP server/
    );
  });

  test("callTool throws when not connected", async () => {
    const client = new MCPClient();
    await assert.rejects(
      async () => client.callTool("test"),
      /Not connected to MCP server/
    );
  });
});

describe("ReactAgent", () => {
  test("can be instantiated", () => {
    const agent = new ReactAgent("fake-api-key", "https://api.openai.com/v1", []);
    assert.strictEqual(agent.maxIterations, 10);
    assert.strictEqual(agent.model, "gpt-4o");
  });

  test("can be instantiated with custom model", () => {
    const agent = new ReactAgent(
      "fake-api-key",
      "https://api.openai.com/v1",
      [],
      "gpt-3.5-turbo"
    );
    assert.strictEqual(agent.model, "gpt-3.5-turbo");
  });

  test("can be instantiated with custom system prompt", () => {
    const customPrompt = "You are a custom assistant.";
    const agent = new ReactAgent(
      "fake-api-key",
      "https://api.openai.com/v1",
      [],
      "gpt-4o",
      customPrompt
    );
    assert.strictEqual(agent.systemPrompt, customPrompt);
  });

  test("getAvailableTools returns empty array with no clients", async () => {
    const agent = new ReactAgent("fake-api-key", "https://api.openai.com/v1", []);
    const tools = await agent.getAvailableTools();
    assert.deepStrictEqual(tools, []);
  });

  test("executeTool returns error for unknown tool", async () => {
    const agent = new ReactAgent("fake-api-key", "https://api.openai.com/v1", []);
    const result = await agent.executeTool({
      function: { name: "unknown_tool", arguments: {} },
    });
    assert.strictEqual(result, "Unknown tool: unknown_tool");
  });
});

describe("OpenAIAgentProvider", () => {
  test("can be instantiated with defaults", () => {
    const provider = new OpenAIAgentProvider();
    assert.strictEqual(provider.id(), "openai-react-agent");
    assert.strictEqual(provider.model, "gpt-4o");
    assert.strictEqual(provider.initializationState, "not_initialized");
  });

  test("can be instantiated with custom id", () => {
    const provider = new OpenAIAgentProvider({ id: "custom-provider" });
    assert.strictEqual(provider.id(), "custom-provider");
  });

  test("can be instantiated with custom config", () => {
    const provider = new OpenAIAgentProvider({
      id: "test-provider",
      config: {
        apiKey: "test-key",
        apiBaseUrl: "https://custom.api.com/v1",
        model: "gpt-3.5-turbo",
        mcpServers: [{ url: "http://localhost:3000" }],
      },
    });
    assert.strictEqual(provider.id(), "test-provider");
    assert.strictEqual(provider.apiKey, "test-key");
    assert.strictEqual(provider.apiBaseUrl, "https://custom.api.com/v1");
    assert.strictEqual(provider.model, "gpt-3.5-turbo");
    assert.strictEqual(provider.mcpServers.length, 1);
  });

  test("cleanup resets state", async () => {
    const provider = new OpenAIAgentProvider();
    await provider.cleanup();
    assert.strictEqual(provider.initializationState, "not_initialized");
    assert.deepStrictEqual(provider.mcpClients, []);
    assert.strictEqual(provider.agent, null);
  });
});

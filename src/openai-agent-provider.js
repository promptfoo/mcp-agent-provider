const MCPClient = require("./mcp-client");
const ReactAgent = require("./react-agent");
require("dotenv").config();

class OpenAIAgentProvider {
  constructor(options = {}) {
    this.providerId = options.id || "openai-react-agent";
    this.apiKey = options.config?.apiKey || process.env.OPENAI_API_KEY;
    this.apiBaseUrl = options.config?.apiBaseUrl || "https://api.openai.com/v1";
    this.mcpServers = options.config?.mcpServers || [];
    this.mcpClients = [];
    this.agent = null;
    this.initialized = false;
  }

  id() {
    return this.providerId;
  }

  async initialize() {
    if (this.initialized) return;

    if (!this.apiKey) {
      throw new Error(
        "OpenAI API key is required. Set OPENAI_API_KEY environment variable or provide it in config."
      );
    }

    for (const server of this.mcpServers) {
      const client = new MCPClient(server.command, server.args || []);
      try {
        await client.connect();
        this.mcpClients.push(client);
        console.log(`Connected to MCP server: ${server.command}`);
      } catch (error) {
        console.error(
          `Failed to connect to MCP server ${server.command}:`,
          error
        );
      }
    }

    this.agent = new ReactAgent(this.apiKey, this.apiBaseUrl, this.mcpClients);
    this.initialized = true;
  }

  async callApi(prompt, context, options) {
    try {
      await this.initialize();

      const enhancedPrompt =
        typeof prompt === "string"
          ? prompt
          : prompt.raw || prompt.label || JSON.stringify(prompt);

      const vars = context.vars || {};
      const fullPrompt = Object.keys(vars).reduce((p, key) => {
        return p.replace(new RegExp(`{{${key}}}`, "g"), vars[key]);
      }, enhancedPrompt);

      const startTime = Date.now();
      const result = await this.agent.run(fullPrompt, context);
      const endTime = Date.now();

      const tokenUsage = {
        total: result.messages.length * 100,
        prompt: Math.floor(result.messages.length * 60),
        completion: Math.floor(result.messages.length * 40),
      };

      console.log(result.toolCalls);

      return {
        output:
          result.response +
          "\n\n Called Tools: " +
          result.toolCalls
            .map(
              (tool) =>
                `Tool called ${tool.function.name} with args \n${JSON.stringify(
                  tool.function.arguments,
                  null,
                  2
                )}`
            )
            .join("\n\n"),
        tokenUsage: tokenUsage,
        cost: tokenUsage.total * 0.00002,
        cached: false,
        metadata: {
          iterations: result.iterations,
          toolCalls: result.toolCalls,
          executionTime: endTime - startTime,
          mcpServersConnected: this.mcpClients.length,
        },
      };
    } catch (error) {
      return {
        error: `Error calling OpenAI agent: ${error.message}`,
        output: null,
      };
    }
  }

  async cleanup() {
    for (const client of this.mcpClients) {
      try {
        await client.disconnect();
      } catch (error) {
        console.error("Error disconnecting MCP client:", error);
      }
    }
    this.mcpClients = [];
    this.initialized = false;
  }
}

module.exports = OpenAIAgentProvider;

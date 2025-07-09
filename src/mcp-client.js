const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const {
  StdioClientTransport,
} = require("@modelcontextprotocol/sdk/client/stdio.js");

class MCPClient {
  constructor(serverCommand, serverArgs = []) {
    this.serverCommand = serverCommand;
    this.serverArgs = serverArgs;
    this.client = null;
    this.transport = null;
    this.process = null;
  }

  async connect() {
    try {
      this.transport = new StdioClientTransport({
        command: this.serverCommand,
        args: this.serverArgs,
        env: process.env,
        stderr: "inherit",
      });

      this.client = new Client(
        {
          name: "agent-custom-provider",
          version: "1.0.0",
        },
        {
          capabilities: {},
        }
      );

      await this.client.connect(this.transport);

      console.log(`Connected to MCP server`);

      return true;
    } catch (error) {
      console.error(`Failed to connect to MCP server: ${error.message}`);
      throw error;
    }
  }

  async listTools() {
    if (!this.client) {
      throw new Error("Client not connected");
    }

    const response = await this.client.listTools();

    return response.tools || [];
  }

  async callTool(toolName, args = {}) {
    if (!this.client) {
      throw new Error("Client not connected");
    }

    const response = await this.client.callTool({
      name: toolName,
      arguments: args,
    });

    return response.content;
  }

  async disconnect() {
    if (this.client) {
      await this.client.close();
    }
    if (this.transport) {
      await this.transport.close();
    }
    if (this.process) {
      this.process.kill();
    }
  }
}

module.exports = MCPClient;

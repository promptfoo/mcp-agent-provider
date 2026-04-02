# AGENTS.md

Guidance for AI agents and developers working on `promptfoo/mcp-agent-provider`.

## Repository Purpose

This package implements a Promptfoo custom provider that wraps an OpenAI chat-completions agent and connects it to one or more MCP servers. It is used for red-team scenarios where Promptfoo evaluates whether an agent will call risky or malicious tools exposed through MCP.

## Common Commands

```bash
# Install dependencies
npm install

# Run Node test suite
npm test

# Run Biome checks
npm run check

# Auto-fix Biome formatting/lint issues
npm run fix
```

CI runs `npm test` on Node 20, 22, and 24, plus `npm run check` on Node 24. The required aggregate status is `CI Success`.

## Code Layout

- `src/openai-agent-provider.js`: Promptfoo provider entrypoint. Handles provider config, MCP client initialization, prompt templating, result formatting, and cleanup.
- `src/react-agent.js`: ReAct loop around OpenAI chat completions. Converts MCP tools into function-call tool definitions and executes tool calls until a final response or iteration limit.
- `src/mcp-client.js`: MCP client/transport layer. Supports stdio command transports, local `.js`/`.py` server files, Streamable HTTP, and SSE fallback.
- `src/mcp_server/`: Local mock MCP server and tool fixtures for examples and development.
- `test/test.js`: Node built-in test coverage for provider, agent, and MCP client helper behavior.
- `promptfooconfig.yaml`: Example Promptfoo red-team configuration.

## Implementation Rules

- Keep the package ESM-only (`"type": "module"` in `package.json`) and preserve explicit `.js` import specifiers.
- Prefer extending the provider, agent, and MCP client classes in their current layers instead of mixing transport logic into `ReactAgent` or prompt orchestration into `MCPClient`.
- Preserve the current initialization behavior in `OpenAIAgentProvider`: concurrent initialization should share one promise, partial MCP connections should be cleaned up on failure, and at least one MCP server must connect when servers are configured.
- Treat tool execution and MCP server responses as untrusted. Keep error handling explicit and avoid logging secrets or committing real `.env` files/API keys.
- Be careful when changing default model, system prompt, or tool-call formatting because Promptfoo red-team assertions may depend on response shape and included tool-call traces.

## Validation

- Run `npm test` after changing provider, agent, MCP client, or mock-server behavior.
- Run `npm run check` before opening a PR.
- For docs-only changes, no build step is required.

## Git Workflow

- Do not commit directly to `main`; create a branch and open a PR.
- Use Conventional Commit subjects (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `build:`, `ci:`, `chore:`) to match existing history and release automation.
- Keep PR descriptions clear about user-facing behavior changes, MCP compatibility impact, and which validation commands were run.

import { randomUUID } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { registerTools } from './tool_registry';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { getApiKey } from '../agents/auth_middleware';

type TransportMap = Record<string, StreamableHTTPServerTransport>;

export function createMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: config.mcp.name,
      version: '2.0.0'
    },
    {
      capabilities: { tools: {}, logging: {} }
    }
  );

  registerTools(server);
  return server;
}

export function createMcpApp() {
  const app = createMcpExpressApp();
  const transports: TransportMap = {};

  app.post('/mcp', async (req, res) => {
    const requiredKey = process.env.MCP_API_KEY;
    if (requiredKey) {
      const apiKey = getApiKey(req);
      if (!apiKey || apiKey !== requiredKey) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (sessionId && transports[sessionId]) {
      await transports[sessionId].handleRequest(req, res, req.body);
      return;
    }

    if (!sessionId && isInitializeRequest(req.body)) {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          transports[sid] = transport;
        }
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && transports[sid]) {
          delete transports[sid];
        }
      };

      const server = createMcpServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
      id: null
    });
  });

  return app;
}

export function startMcpServer(): void {
  const app = createMcpApp();
  const bindHost = process.env.MCP_BIND_HOST || '127.0.0.1';
  app.listen(config.mcp.port, bindHost, () => {
    logger.info(`MCP server listening on ${bindHost}:${config.mcp.port}`);
  });
}

if (require.main === module) {
  startMcpServer();
}

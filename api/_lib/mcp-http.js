import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { listRecords, readRecord, createRecord, updateRecord, COLLECTIONS } from './mcp-workspace.js';
import { authenticateMcpBearer } from './mcp-auth.js';
import { listTodoLists, listTodoItems, createTodoList, addTodoTask, updateTodoTask } from './mcp-todo.js';

const id = z.string().min(1).max(128);
const title = z.string().trim().min(1).max(300);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Use a real date in YYYY-MM-DD format');
const priority = z.enum(['low', 'medium', 'high']);
const description = z.string().max(4000);
const workspaceApp = z.enum(COLLECTIONS);
const workspaceFields = { name: title.optional(), content: z.string().max(16000).optional(),
  calId: id.optional(), start: z.string().datetime({ offset: true }).optional(),
  end: z.string().datetime({ offset: true }).optional() };

function mcpServer(binding) {
  const server = new McpServer({ name: 'workdeck', version: '0.2.0' });
  const tool = (name, info, permission, run) => {
    server.registerTool(name, info, async args => {
      if (!Array.isArray(binding.permissions) || !binding.permissions.includes(permission)) {
        return { isError: true, content: [{ type: 'text', text: 'Permission denied' }] };
      }
      try {
        const data = await run(args);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      } catch (error) {
        // All service errors are fixed messages; never include exception stacks or credentials.
        return { isError: true, content: [{ type: 'text', text: error.message }] };
      }
    });
  };

  tool('todo_lists', {
    description: 'List the Todo lists in your connected Workdeck account.', inputSchema: {}
  }, 'todo:read', () => listTodoLists(binding.accountHash));
  tool('todo_items', {
    description: 'Read tasks in a Workdeck Todo list. Use todo_lists to find the list ID.',
    inputSchema: { listId: id, offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(50).default(50) }
  }, 'todo:read', ({ listId, offset, limit }) => listTodoItems(binding.accountHash, listId, offset, limit));
  tool('todo_create_list', {
    description: 'Create an empty Todo list in your connected Workdeck account.',
    inputSchema: { name: title }
  }, 'todo:write', ({ name }) => createTodoList(binding.accountHash, name));
  tool('todo_add_task', {
    description: 'Add a task to an existing Todo list; use todo_lists to obtain its list ID.',
    inputSchema: { listId: id, title, description: description.optional(),
      dueDate: date.optional(), priority: priority.optional() }
  }, 'todo:write', ({ listId, ...fields }) => addTodoTask(binding.accountHash, listId, fields));
  tool('todo_update_task', {
    description: 'Update an existing task in a Todo list. Supply only fields you want to change.',
    inputSchema: { listId: id, taskId: id, title: title.optional(), description: description.optional(),
      dueDate: date.nullable().optional(), priority: priority.optional(), completed: z.boolean().optional() }
  }, 'todo:write', ({ listId, taskId, ...fields }) => updateTodoTask(binding.accountHash, listId, taskId, fields));
  tool('workspace_list', {
    description: 'List records from a Workdeck app. Files and sheets list metadata only; Todo has dedicated task tools.',
    inputSchema: { app: workspaceApp, offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(50).default(50) }
  }, 'workspace:read', ({ app, offset, limit }) => listRecords(binding.accountHash, app, offset, limit));
  tool('workspace_read', {
    description: 'Read one Workdeck record (maximum 64 KB). File bytes and spreadsheet workbook bodies are not included.',
    inputSchema: { app: workspaceApp, recordId: id }
  }, 'workspace:read', ({ app, recordId }) => readRecord(binding.accountHash, app, recordId));
  tool('workspace_create', {
    description: 'Create a document, blog draft, calendar, event, kanban board, empty form, slide deck or drawing. Sheets, files and folders are read-only; use Todo tools for tasks. For events supply calId, start and end (ISO date-times).',
    inputSchema: { app: workspaceApp, ...workspaceFields }
  }, 'workspace:write', ({ app, ...fields }) => createRecord(binding.accountHash, app, fields));
  tool('workspace_update', {
    description: 'Change a record name/title, plain-text document content, draft blog HTML, or event description/dates. Does not publish or delete anything.',
    inputSchema: { app: workspaceApp, recordId: id, name: title.optional(), content: workspaceFields.content,
      start: workspaceFields.start, end: workspaceFields.end }
  }, 'workspace:write', ({ app, recordId, ...changes }) => updateRecord(binding.accountHash, app, recordId, changes));
  return server;
}

/** Stateless per-request transport — no Vercel instance-local session data. */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  // A remote MCP client normally sends no Origin. Reject unexpected browser
  // origins as required for HTTP transport DNS-rebinding protection.
  const expectedOrigin = process.env.MCP_PUBLIC_ORIGIN ||
    (process.env.NODE_ENV === 'development' ? `http://${req.headers.host}` : undefined);
  if (req.headers.origin && req.headers.origin !== expectedOrigin) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  if (process.env.NODE_ENV !== 'development' &&
      (!process.env.PEPPER_SECRET ||
        process.env.PEPPER_SECRET === 'dev-pepper-change-in-production-9F2a-5xK8' ||
        !/^https:\/\/[^/?#]+$/.test(expectedOrigin || '') ||
        !/^[a-f0-9]{64}$/i.test(process.env.MCP_AUTH_SECRET || ''))) {
    return res.status(503).json({ error: 'MCP not configured' });
  }
  let binding;
  try {
    binding = await authenticateMcpBearer(req.headers.authorization);
  } catch (error) {
    console.error('[MCP] Credential check failed:', error);
    return res.status(503).json({ error: 'MCP temporarily unavailable' });
  }
  if (!binding) {
    if (expectedOrigin) res.setHeader('WWW-Authenticate',
      `Bearer resource_metadata="${expectedOrigin}/.well-known/oauth-protected-resource/api/mcp"`);
    else res.setHeader('WWW-Authenticate', 'Bearer');
    return res.status(401).json({ error: 'MCP authorization required' });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const server = mcpServer(binding);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, enableJsonResponse: true
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('[MCP] Request failed:', error);
    if (!res.headersSent) res.status(500).json({ error: 'MCP request failed' });
  } finally {
    await server.close();
  }
}

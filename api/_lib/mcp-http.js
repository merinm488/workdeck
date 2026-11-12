import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { listRecords, readRecord, createRecord, updateRecord, COLLECTIONS } from './mcp-workspace.js';
import { addBoardColumn, upsertBoardCard, upsertFormQuestion, addSlide, addCanvasObject, updateCanvasObject,
  createSheet, sheetCells, createFolder, uploadFile, readFile } from './mcp-content.js';
import { authenticateMcpBearer } from './mcp-auth.js';
import { listTodoLists, listTodoItems, createTodoList, renameTodoList, addTodoTask, updateTodoTask } from './mcp-todo.js';

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
const cell = z.object({ row: z.number().int().min(0).max(9999), column: z.number().int().min(0).max(999),
  value: z.union([z.string().max(4000), z.number().finite(), z.boolean(), z.null()]) });

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
  tool('todo_rename_list', {
    description: 'Rename an existing Todo list.', inputSchema: { listId: id, name: title }
  }, 'todo:write', ({ listId, name }) => renameTodoList(binding.accountHash, listId, name));
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
    description: 'Create a document, blog draft, calendar, event, kanban board, empty form, slide deck or drawing. For structured contents use kanban_add_column/kanban_upsert_card, form_upsert_question, slides_add_text or draw_add_text. Use sheet_create for spreadsheets, folder_create and file_upload for Files, and Todo tools for tasks. For events supply calId, start and end (ISO date-times).',
    inputSchema: { app: workspaceApp, ...workspaceFields }
  }, 'workspace:write', ({ app, ...fields }) => createRecord(binding.accountHash, app, fields));
  tool('workspace_update', {
    description: 'Rename a Workdeck record (including Sheets, Files and folders), change plain-text document content or draft blog HTML, or edit event description/dates. For structured board, form, slide, drawing and sheet contents use their dedicated tools. Does not publish or delete anything.',
    inputSchema: { app: workspaceApp, recordId: id, name: title.optional(), content: workspaceFields.content,
      start: workspaceFields.start, end: workspaceFields.end }
  }, 'workspace:write', ({ app, recordId, ...changes }) => updateRecord(binding.accountHash, app, recordId, changes));
  tool('kanban_create_board', {
    description: 'Create a Kanban board with one empty column. Use kanban_add_column and kanban_upsert_card to fill it.',
    inputSchema: { name: title }
  }, 'workspace:write', ({ name }) => createRecord(binding.accountHash, 'kanban', { name }));
  tool('kanban_add_column', {
    description: 'Add a column to a board. Use kanban_upsert_card to put cards in it.',
    inputSchema: { boardId: id, label: title }
  }, 'workspace:write', ({ boardId, label }) => addBoardColumn(binding.accountHash, boardId, label));
  tool('kanban_upsert_card', {
    description: 'Create or edit a Kanban card. Supply cardId to edit; column is a column ID from workspace_read.',
    inputSchema: { boardId: id, cardId: id.optional(), column: id.optional(), label: title.optional(),
      description: description.optional(), priority: z.enum(['low', 'medium', 'high']).optional(),
      progress: z.number().min(0).max(100).optional() }
  }, 'workspace:write', ({ boardId, ...fields }) => upsertBoardCard(binding.accountHash, boardId, fields));
  tool('form_create', {
    description: 'Create a form with a Submit button. Use form_upsert_question to add survey questions.',
    inputSchema: { name: title }
  }, 'workspace:write', ({ name }) => createRecord(binding.accountHash, 'forms', { name }));
  tool('form_upsert_question', {
    description: 'Add or edit a form-js question. Supply questionId to edit; select/radio/checklist require choices. Shared forms must be unshared first.',
    inputSchema: { formId: id, questionId: id.optional(), label: title.optional(),
      type: z.enum(['textfield', 'textarea', 'number', 'datetime', 'checkbox', 'select', 'radio', 'checklist']).optional(),
      required: z.boolean().optional(), choices: z.array(title).min(1).max(30).optional() }
  }, 'workspace:write', ({ formId, ...fields }) => upsertFormQuestion(binding.accountHash, formId, fields));
  tool('slides_create_deck', {
    description: 'Create a slide deck with one blank slide. Use workspace_read with app=slides to get the first slide ID, then slides_add_text.',
    inputSchema: { name: title }
  }, 'workspace:write', ({ name }) => createRecord(binding.accountHash, 'slides', { name }));
  tool('slides_add_slide', {
    description: 'Append a slide to a deck (new decks already contain a blank first slide). Use slides_add_text or canvas_add_object with the returned slide ID.',
    inputSchema: { deckId: id, name: title.optional() }
  }, 'workspace:write', ({ deckId, name }) => addSlide(binding.accountHash, deckId, name));
  tool('slides_add_text', {
    description: 'Put text on an existing slide (new decks already contain a blank first slide). Use workspace_read with app=slides to get deckId and slideId. Coordinates are slide pixels (960 x 540).',
    inputSchema: { deckId: id, slideId: id, text: z.string().min(1).max(4000),
      left: z.number().finite().min(-100000).max(100000), top: z.number().finite().min(-100000).max(100000),
      width: z.number().min(1).max(10000).optional(), fontSize: z.number().min(1).max(300).optional(),
      fill: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() }
  }, 'workspace:write', ({ deckId, ...fields }) => addCanvasObject(binding.accountHash, 'slides', deckId, fields));
  tool('draw_create', {
    description: 'Create an empty drawing. Use draw_add_text to populate its canvas.',
    inputSchema: { name: title }
  }, 'workspace:write', ({ name }) => createRecord(binding.accountHash, 'draws', { name }));
  tool('draw_add_text', {
    description: 'Put text on a Draw canvas. Use workspace_read with app=draws to find the drawing ID. Coordinates are canvas pixels.',
    inputSchema: { drawingId: id, text: z.string().min(1).max(4000),
      left: z.number().finite().min(-100000).max(100000), top: z.number().finite().min(-100000).max(100000),
      width: z.number().min(1).max(10000).optional(), fontSize: z.number().min(1).max(300).optional(),
      fill: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() }
  }, 'workspace:write', ({ drawingId, ...fields }) => addCanvasObject(binding.accountHash, 'draws', drawingId, fields));
  tool('canvas_add_object', {
    description: 'Add text or a rectangle to a slide or Draw canvas. For slides, slideId is required. Coordinates are canvas pixels.',
    inputSchema: { app: z.enum(['slides', 'draws']), recordId: id, slideId: id.optional(),
      shape: z.enum(['text', 'rect']).optional(), text: z.string().max(4000).optional(),
      left: z.number().finite().min(-100000).max(100000), top: z.number().finite().min(-100000).max(100000),
      width: z.number().min(1).max(10000).optional(), height: z.number().min(1).max(10000).optional(),
      fontSize: z.number().min(1).max(300).optional(), fill: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() }
  }, 'workspace:write', ({ app, recordId, ...fields }) => addCanvasObject(binding.accountHash, app, recordId, fields));
  tool('canvas_update_object', {
    description: 'Update text, position or fill of an existing slide or Draw object. Get its zero-based objectIndex from workspace_read or canvas_add_object.',
    inputSchema: { app: z.enum(['slides', 'draws']), recordId: id, slideId: id.optional(),
      objectIndex: z.number().int().min(0), text: z.string().max(4000).optional(),
      left: z.number().finite().min(-100000).max(100000).optional(),
      top: z.number().finite().min(-100000).max(100000).optional(),
      fill: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() }
  }, 'workspace:write', ({ app, recordId, objectIndex, ...fields }) =>
    updateCanvasObject(binding.accountHash, app, recordId, objectIndex, fields));
  tool('sheet_create', {
    description: 'Create a Univer spreadsheet with one empty tab. Then use sheet_write_cells to populate it.', inputSchema: { name: title }
  }, 'workspace:write', ({ name }) => createSheet(binding.accountHash, name));
  tool('sheet_read_cells', {
    description: 'Read up to 200 populated cells of a spreadsheet. Use workspace_list with app=sheets for sheetId. Optional tabId selects a tab; defaults to first tab.',
    inputSchema: { sheetId: id, tabId: id.optional() }
  }, 'workspace:read', ({ sheetId, tabId }) => sheetCells(binding.accountHash, sheetId, undefined, tabId));
  tool('sheet_write_cells', {
    description: 'Write up to 100 spreadsheet cells by zero-based row and column. value=null clears a cell. Use sheet_read_cells to find tabId and inspect the result.',
    inputSchema: { sheetId: id, tabId: id.optional(), cells: z.array(cell).min(1).max(100) }
  }, 'workspace:write', ({ sheetId, tabId, cells }) => sheetCells(binding.accountHash, sheetId, cells, tabId));
  tool('sheet_cells', {
    description: 'Read up to 200 populated spreadsheet cells, or write up to 100 cells by zero-based row and column. value=null clears a cell. Omit cells to read.',
    inputSchema: { sheetId: id, tabId: id.optional(), cells: z.array(cell).min(1).max(100).optional() }
  }, 'workspace:read', ({ sheetId, tabId, cells }) => {
    if (cells && !binding.permissions.includes('workspace:write')) throw new Error('Permission denied');
    return sheetCells(binding.accountHash, sheetId, cells, tabId);
  });
  tool('folder_create', {
    description: 'Create a Files folder, optionally inside an existing folder.',
    inputSchema: { name: title, parentId: id.optional() }
  }, 'workspace:write', ({ name, parentId }) => createFolder(binding.accountHash, name, parentId));
  tool('file_upload', {
    description: 'Upload file bytes supplied as base64 (maximum 100 KB). A remote MCP connector CANNOT read a local path on your device; attach/provide bytes in the AI client, or upload larger files using the Workdeck Files UI.',
    inputSchema: { name: title, mime: z.string().min(1).max(128), base64: z.string().min(1).max(140000).regex(/^[A-Za-z0-9+/]+={0,2}$/), folderId: id.optional() }
  }, 'workspace:write', fields => uploadFile(binding.accountHash, fields));
  tool('file_read', {
    description: 'Read a Workdeck file as base64 (maximum 100 KB).', inputSchema: { fileId: id }
  }, 'workspace:read', ({ fileId }) => readFile(binding.accountHash, fileId));
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

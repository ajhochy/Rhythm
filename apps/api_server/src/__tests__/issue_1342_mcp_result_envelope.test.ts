import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { getDb, setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

const MCP_RESULT = {
  structuredContent: {
    kind: 'unknown-app-result',
    rows: [{ label: 'Alpha', value: 7 }],
  },
  _meta: {
    source: 'contract-mcp-server',
    nested: { retained: true },
  },
  isError: false,
};

describe('issue #1342 API MCP result envelope contracts', () => {
  let db: Database.Database;
  let sessionId: string;
  let messages: AgentSessionMessagesRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    sessionId = new AgentSessionsRepository().insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: '/tmp',
      name: 'issue-1342-contract',
    }).id;
    messages = new AgentSessionMessagesRepository();
  });

  afterEach(() => db.close());

  it('issue-1342-c2: adding an MCP envelope never replaces the existing text output', () => {
    // Regression caught: the new serializer returned only structuredContent,
    // leaving older Flutter builds with a blank tool result. The rawText and
    // completed-state output assertions both fail if text compatibility breaks.
    messages.upsertStructured(
      sessionId,
      'msg-structured',
      'output',
      JSON.stringify([
        {
          id: 'part-text',
          type: 'text',
          text: 'Existing assistant prose',
        },
        {
          id: 'part-tool',
          type: 'tool',
          tool: 'contract_unknown_tool',
          state: {
            status: 'completed',
            input: {},
            title: '',
            output: 'Readable fallback text',
            metadata: {},
            mcpResult: MCP_RESULT,
            time: { start: 1, end: 2 },
          },
        },
      ]),
      null,
      null,
    );

    const row = messages.listBySessionStructured(sessionId)[0];
    const part = row.parts[1] as Record<string, any>;
    expect(row.rawText).toBe('Existing assistant prose');
    expect(part.state.output).toBe('Readable fallback text');
    expect(part.state.mcpResult).toEqual(MCP_RESULT);
  });

  it('issue-1342-c5: the result envelope persists inside parts_json without schema changes', () => {
    // Regression caught: an implementation adds MCP-specific SQL columns,
    // creating SQLite/Postgres drift. The exact column assertion fails for any
    // migration while the round-trip assertion proves existing JSON storage is
    // sufficient.
    const before = (getDb().pragma('table_info(agent_session_messages)') as Array<{ name: string }>)
      .map((column) => column.name)
      .sort();

    messages.upsertStructured(
      sessionId,
      'msg-no-migration',
      'output',
      JSON.stringify([
        {
          id: 'part-no-migration',
          type: 'tool',
          tool: 'contract_unknown_tool',
          state: {
            status: 'completed',
            input: {},
            title: '',
            output: 'Text survives',
            metadata: {},
            mcpResult: MCP_RESULT,
            time: { start: 1, end: 2 },
          },
        },
      ]),
      null,
      null,
    );

    const after = (getDb().pragma('table_info(agent_session_messages)') as Array<{ name: string }>)
      .map((column) => column.name)
      .sort();
    expect(after).toEqual(before);
    expect(after).not.toContain('structured_content_json');
    expect(after).not.toContain('mcp_meta_json');
    expect(after).not.toContain('mcp_is_error');

    const stored = getDb()
      .prepare('SELECT parts_json FROM agent_session_messages WHERE session_id = ? AND sdk_message_id = ?')
      .get(sessionId, 'msg-no-migration') as { parts_json: string };
    expect(JSON.parse(stored.parts_json)[0].state.mcpResult).toEqual(MCP_RESULT);
  });
});

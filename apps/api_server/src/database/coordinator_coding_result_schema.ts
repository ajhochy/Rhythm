import type Database from 'better-sqlite3';

export const CODING_ASYNC_COLUMNS = ['coding_delivery_mode', 'coding_root_session_id', 'coding_operation_key',
  'coding_terminal_json', 'coding_result_receipt_json', 'result_message_id', 'coding_test_hold_json'] as const;

/** Existing async rows own execution/outbox; never a new status/ledger or CHECK rebuild. */
export function installCodingResultSchema(db: Database.Database): void {
  const messages=db.pragma('table_info(agent_session_messages)') as Array<{name:string}>;
  if (!messages.some(c=>c.name==='local_event_key')) db.exec('ALTER TABLE agent_session_messages ADD COLUMN local_event_key TEXT NULL');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_messages_local_event ON agent_session_messages(session_id,local_event_key) WHERE local_event_key IS NOT NULL');
  const columns = db.pragma('table_info(agent_async_delegations)') as Array<{name:string;type:string;notnull:number;dflt_value:unknown}>;
  for (const name of CODING_ASYNC_COLUMNS) {
    const column = columns.find(c => c.name === name);
    if (!column) db.exec(`ALTER TABLE agent_async_delegations ADD COLUMN ${name} TEXT NULL`);
    else if (column.type.toUpperCase() !== 'TEXT' || column.notnull || column.dflt_value !== null) {
      throw new Error('Noncanonical coding result storage; held');
    }
  }
  const journal = db.pragma('table_info(coordinator_conversation_commands)') as Array<{name:string}>;
  if (!journal.some(c => c.name === 'callback_acceptance')) {
    db.exec('ALTER TABLE coordinator_conversation_commands ADD COLUMN callback_acceptance TEXT NULL');
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_async_coding_recovery ON agent_async_delegations(coding_root_session_id,result_message_id);
    CREATE TRIGGER IF NOT EXISTS async_coding_binding_immutable BEFORE UPDATE ON agent_async_delegations
    WHEN (OLD.coding_delivery_mode IS NOT NULL AND OLD.coding_delivery_mode IS NOT NEW.coding_delivery_mode)
      OR (OLD.coding_root_session_id IS NOT NULL AND OLD.coding_root_session_id IS NOT NEW.coding_root_session_id)
      OR (OLD.coding_operation_key IS NOT NULL AND OLD.coding_operation_key IS NOT NEW.coding_operation_key)
      OR (OLD.coding_terminal_json IS NOT NULL AND OLD.coding_terminal_json IS NOT NEW.coding_terminal_json)
      OR (OLD.result_message_id IS NOT NULL AND OLD.result_message_id IS NOT NEW.result_message_id)
    BEGIN SELECT RAISE(ABORT,'coding result immutable binding'); END;`);
}

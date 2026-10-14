import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
const require = createRequire(new URL('../../apps/api_server/package.json',import.meta.url));
const Database=require('better-sqlite3');
assert.equal(process.env.RHYTHM_SANDBOX_API_PORT,'4898');
const db=new Database(`${process.env.RHYTHM_SANDBOX_DIR}/rhythm.db`,{readonly:true});
const token=db.prepare('SELECT token FROM sessions WHERE user_id=1 LIMIT 1').get().token; db.close();
const response=await fetch('http://127.0.0.1:4898/hermes-notify/events',{headers:{authorization:`Bearer ${token}`}});
assert.equal(response.status,200);
const body=await response.json();
const file=`${process.env.RHYTHM_SANDBOX_DIR}/notify-restart-receipt.json`;
if(process.argv[2]==='before'){
  assert.ok(body.events.length>0); writeFileSync(file,JSON.stringify(body),{mode:0o600,flag:'wx'});
  console.log(`RESTART before: ${body.events.length} durable pending events`);
}else{
  const before=JSON.parse(readFileSync(file,'utf8'));
  for(const event of before.events) assert.deepEqual(body.events.find(e=>e.eventId===event.eventId),event);
  console.log(`RESTART after: ${before.events.length} identical IDs/cursors/payloads recovered`);
}

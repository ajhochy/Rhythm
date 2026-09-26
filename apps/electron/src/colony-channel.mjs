// Closed version-1 wire schema; matches the pinned upstream embedded protocol.
const CONTROL_BYTES = 64 * 1024
const FRAME_BYTES = 1024 * 1024
/** @param {any} value */
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value)
/** @param {any} value */
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
/** @param {any} value */
const integer = value => Number.isSafeInteger(value) && value >= 0
/** @param {any} value */
const bytes = value => Buffer.byteLength(JSON.stringify(value))
/** @param {string} code @param {string} message @returns {never} */
const fail = (code, message) => { throw Object.assign(new Error(message), { code }) }
/** @type {Record<string, [string[], string[]]>} */
export const COLONY_REQUEST_SCHEMAS = {
  'state.read': [[], []],
  'state.write': [['state', 'baseUpdatedAt'], []],
  'state.mark': [['threadId'], ['archived', 'viewedAt']],
  'state.begin': [['baseUpdatedAt', 'totalBytes', 'sha256'], []],
  'state.chunk': [['transferId', 'index', 'data'], []],
  'state.commit': [['transferId'], []],
  'state.cancel': [['transferId'], []],
  'state.readChunk': [['transferId', 'offset'], []],
  'state.readCancel': [['transferId'], []],
  'inventory.page': [[], ['generation', 'cursor', 'collection', 'limit']],
  'inventory.cancel': [['generation'], []],
  'action.run': [['kind', 'id'], []],
  'scene.select': [['threadId'], []],
  'scene.status': [['webgl'], []],
}
/** @type {Record<string, [string[], string[]]>} */
export const COLONY_HOST_EVENT_SCHEMAS = {
  'host.select': [['threadId'], []],
  'host.filter': [[], ['query', 'harness', 'activity', 'includeHistorical']],
  'host.view': [[], ['quality', 'sound', 'motion', 'resetCamera', 'focusSelection']],
  'host.visibility': [['hidden'], []],
}

/** @param {any} value */
function jsonOnly(value) {
  const pending = /** @type {{value:any,depth?:number,exit?:boolean}[]} */ ([{ value, depth: 0 }])
  const ancestors = new Set()
  while (pending.length) {
    const { value: item, depth = 0, exit } = /** @type {{value:any,depth?:number,exit?:boolean}} */ (pending.pop())
    if (exit) { ancestors.delete(item); continue }
    if (item === null || typeof item === 'string' || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))) continue
    if (!item || typeof item !== 'object' || depth > 64 || ancestors.has(item)) fail('invalid_request', 'Expected bounded JSON data')
    ancestors.add(item)
    pending.push({ value: item, exit: true })
    if (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item))) fail('invalid_request', 'Expected plain JSON data')
    for (const key of Reflect.ownKeys(item)) {
      if (Array.isArray(item) && key === 'length') continue
      const descriptor = Object.getOwnPropertyDescriptor(item, key)
      if (typeof key !== 'string' || !descriptor || !Object.hasOwn(descriptor, 'value')) fail('invalid_request', 'Expected plain JSON fields')
      pending.push({ value: descriptor.value, depth: depth + 1 })
    }
  }
}

/** @param {any} message @param {string} documentId */
export function validateColonyRequest(message, documentId) {
  jsonOnly(message)
  if (!object(message) || Object.keys(message).length !== 5 || !['v', 'documentId', 'id', 'method', 'payload'].every(key => Object.hasOwn(message, key))) fail('invalid_request', 'Invalid request envelope')
  if (message.v !== 1) fail('unsupported_version', 'Unsupported Colony protocol version')
  if (!id(message.id) || !id(message.documentId)) fail('invalid_request', 'Invalid request identity')
  if (message.documentId !== documentId) fail('revoked', 'Colony document was revoked')
  if (typeof message.method !== 'string' || !Object.hasOwn(COLONY_REQUEST_SCHEMAS, message.method)) fail('unsupported_method', 'Unsupported Colony method')
  if (bytes(message) > (message.method === 'state.chunk' ? FRAME_BYTES : CONTROL_BYTES)) fail('oversize', 'Colony request exceeds its frame limit')
  const payload = message.payload
  const [required, optional] = COLONY_REQUEST_SCHEMAS[message.method]
  if (!object(payload) || required.some(key => !Object.hasOwn(payload, key)) || Object.keys(payload).some(key => !required.includes(key) && !optional.includes(key))) fail('invalid_request', 'Invalid Colony method fields')
  for (const key of ['transferId', 'generation']) if (Object.hasOwn(payload, key) && !id(payload[key])) fail('invalid_request', 'Invalid transfer identity')
  for (const key of ['baseUpdatedAt', 'index', 'offset']) if (Object.hasOwn(payload, key) && !integer(payload[key])) fail('invalid_request', 'Invalid state position')
  if (Object.hasOwn(payload, 'state') && !object(payload.state)) fail('invalid_request', 'State must be an object')
  if (Object.hasOwn(payload, 'totalBytes') && (!integer(payload.totalBytes) || payload.totalBytes < 1 || payload.totalBytes > 32 * 1024 * 1024)) fail('oversize', 'State transfer exceeds 32 MiB')
  if (Object.hasOwn(payload, 'sha256') && (typeof payload.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(payload.sha256))) fail('invalid_request', 'Invalid transfer digest')
  if (Object.hasOwn(payload, 'data') && typeof payload.data !== 'string') fail('invalid_request', 'Invalid transfer data')
  if (Object.hasOwn(payload, 'limit') && (!integer(payload.limit) || payload.limit < 1 || payload.limit > 250)) fail('invalid_request', 'Invalid inventory page limit')
  if (Object.hasOwn(payload, 'cursor') && (typeof payload.cursor !== 'string' || !/^(0|[1-9][0-9]{0,8})$/.test(payload.cursor))) fail('invalid_request', 'Invalid inventory cursor')
  if (Object.hasOwn(payload, 'collection') && !['threads', 'projects', 'warnings'].includes(payload.collection)) fail('invalid_request', 'Invalid inventory collection')
  if (Object.hasOwn(payload, 'threadId') && (typeof payload.threadId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,127}$/.test(payload.threadId))) fail('invalid_request', 'Invalid thread identity')
  if (message.method === 'action.run' && (!['open', 'reveal', 'copyPath'].includes(payload.kind) || typeof payload.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,127}$/.test(payload.id))) fail('invalid_request', 'Invalid Colony action')
  if (Object.hasOwn(payload, 'webgl') && !['ready', 'lost'].includes(payload.webgl)) fail('invalid_request', 'Invalid WebGL status')
  if (message.method === 'state.mark' && !Object.hasOwn(payload, 'archived') && !Object.hasOwn(payload, 'viewedAt')) fail('invalid_request', 'State mark requires a change')
  if (Object.hasOwn(payload, 'archived') && typeof payload.archived !== 'boolean') fail('invalid_request', 'Invalid archive mark')
  if (Object.hasOwn(payload, 'viewedAt') && !integer(payload.viewedAt)) fail('invalid_request', 'Invalid viewed timestamp')
}

/** @param {any} message @param {string} documentId */
export function validateColonyHostEvent(message, documentId) {
  jsonOnly(message)
  if (!object(message) || Object.keys(message).length !== 4 || message.v !== 1 || message.documentId !== documentId ||
    typeof message.event !== 'string' || !Object.hasOwn(COLONY_HOST_EVENT_SCHEMAS, message.event)) fail('invalid_request', 'Invalid Colony host event')
  if (bytes(message) > CONTROL_BYTES) fail('oversize', 'Colony host event exceeds its frame limit')
  const [required, optional] = COLONY_HOST_EVENT_SCHEMAS[message.event]
  const payload = message.payload
  if (!object(payload) || required.some(key => !Object.hasOwn(payload, key)) || Object.keys(payload).some(key => !required.includes(key) && !optional.includes(key))) fail('invalid_request', 'Invalid Colony host event fields')
  if (Object.hasOwn(payload, 'threadId') && (typeof payload.threadId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,127}$/.test(payload.threadId))) fail('invalid_request', 'Invalid thread identity')
  if (Object.hasOwn(payload, 'query') && (typeof payload.query !== 'string' || payload.query.length > 512)) fail('invalid_request', 'Invalid host query')
  const allowedHarness = ['hermes', 'codex', 'rhythm', 'opencode', 'kilocode', 'claude-code', 'cursor', 'antigravity']
  const allowedActivity = ['working', 'waiting', 'blocked', 'celebrating', 'idle', 'unknown']
  if (Object.hasOwn(payload, 'harness') && (!Array.isArray(payload.harness) || payload.harness.length > allowedHarness.length || new Set(payload.harness).size !== payload.harness.length || payload.harness.some((/** @type {string} */ value) => !allowedHarness.includes(value)))) fail('invalid_request', 'Invalid harness filter')
  if (Object.hasOwn(payload, 'activity') && (!Array.isArray(payload.activity) || payload.activity.length > allowedActivity.length || new Set(payload.activity).size !== payload.activity.length || payload.activity.some((/** @type {string} */ value) => !allowedActivity.includes(value)))) fail('invalid_request', 'Invalid activity filter')
  for (const key of ['includeHistorical', 'sound', 'resetCamera', 'focusSelection', 'hidden']) if (Object.hasOwn(payload, key) && typeof payload[key] !== 'boolean') fail('invalid_request', `Invalid ${key} setting`)
  if (Object.hasOwn(payload, 'quality') && !['auto', 'high', 'balanced', 'low'].includes(payload.quality)) fail('invalid_request', 'Invalid quality setting')
  if (Object.hasOwn(payload, 'motion') && !['full', 'reduced'].includes(payload.motion)) fail('invalid_request', 'Invalid motion setting')
  if (message.event === 'host.view' && Object.keys(payload).length === 0) fail('invalid_request', 'Host view requires a change')
}

/** @param {any} message @param {string} documentId */
export function validateColonyResponse(message, documentId) {
  jsonOnly(message)
  if (!object(message) || message.v !== 1 || message.documentId !== documentId || !id(message.id) ||
    typeof message.ok !== 'boolean' || Object.keys(message).length !== 5 || bytes(message) > FRAME_BYTES ||
    !['v', 'documentId', 'id', 'ok', message.ok ? 'result' : 'error'].every(key => Object.hasOwn(message, key))) fail('invalid_response', 'Invalid Colony response')
  if (!message.ok && (!object(message.error) || Object.keys(message.error).length !== 2 ||
    !['invalid_request','unsupported_version','revoked','unsupported_method','oversize','busy','state_conflict','unavailable'].includes(message.error.code) ||
    typeof message.error.message !== 'string' || message.error.message.length > 1024)) fail('invalid_response', 'Invalid Colony error')
}

'use strict';
const guard = require('./grid_transport_guard.cjs').install('api');
// A preload cannot await CJS initialization. Refuse the process if local handshake fails.
guard.ready.catch(() => { process.stderr.write('GRID_PRELOAD_NOT_READY\n'); process.exitCode = 78; });

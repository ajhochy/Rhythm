import { execFileSync } from 'node:child_process';
import { closeSync, constants, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const refuse = (): never => { throw new Error('Refusing unowned sandbox engine attachment/provenance'); };
const osRead = (file: string, args: string[]) => execFileSync(file, args, { encoding: 'utf8', timeout: 5000 });
// Read documented kernel metadata without exec of macOS's setuid /bin/ps.
// This is process evidence, not an alternate ownership record/permission source.
const ps = (pid: number, field: string): string => {
  if (process.platform !== 'darwin' || !Number.isSafeInteger(pid) || pid <= 1 ||
      !['uid', 'ppid', 'lstart'].includes(field)) return refuse();
  const observed = JSON.parse(osRead('/usr/bin/python3', ['-I', '-c', String.raw`
import ctypes,json,os,sys,time
pid=int(sys.argv[1])
if not 1 < pid < 2147483648: raise ValueError('invalid process identity')
class Bsd(ctypes.Structure):
    _fields_=[(n,ctypes.c_uint32) for n in ('flags','status','xstatus','pid','ppid','uid','gid','ruid','rgid','svuid','svgid','reserved')]+[('comm',ctypes.c_char*16),('name',ctypes.c_char*32)]+[(n,ctypes.c_uint32) for n in ('nfiles','pgid','jobc','tdev','tpgid')]+[('nice',ctypes.c_int32),('sec',ctypes.c_uint64),('usec',ctypes.c_uint64)]
lib=ctypes.CDLL('/usr/lib/libproc.dylib',use_errno=True)
lib.proc_pidinfo.argtypes=[ctypes.c_int,ctypes.c_int,ctypes.c_uint64,ctypes.c_void_p,ctypes.c_int]
lib.proc_pidinfo.restype=ctypes.c_int
def read():
    b=Bsd()
    if ctypes.sizeof(b)!=136 or lib.proc_pidinfo(pid,3,0,ctypes.byref(b),136)!=136:
        raise OSError(ctypes.get_errno(),'kernel process metadata unavailable')
    if b.pid!=pid or b.uid!=os.getuid() or not b.sec or b.usec>=1000000 or b.status==5:
        raise ValueError('missing or foreign process')
    return b
a=read()
result=dict(uid=str(a.uid),ppid=str(a.ppid),lstart=time.strftime('%a %b %e %H:%M:%S %Y',time.localtime(a.sec)))
b=read()
if (a.pid,a.uid,a.ppid,a.sec,a.usec)!=(b.pid,b.uid,b.ppid,b.sec,b.usec):
    raise ValueError('process changed during inspection')
print(json.dumps(result))
`, String(pid)]));
  if (!observed || typeof observed[field] !== 'string' || !observed[field].trim()) return refuse();
  return observed[field];
};
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const ownershipFile = (sb: string) => join(sb, 'opencode_engine.ownership.json');

function ownedPath(path: string, directory = false): void {
  const info = lstatSync(path);
  if (info.uid !== process.getuid?.() || realpathSync(path) !== path ||
      (directory ? !info.isDirectory() : !info.isFile())) refuse();
}

function ports(port: number): { api: number; engine: number; gateway: number } {
  const result = { api: Number(process.env.PORT), engine: port, gateway: Number(process.env.RHYTHM_MOBILE_GATEWAY_PORT) };
  const values = Object.values(result);
  if (values.some(p => !Number.isInteger(p) || p < 1024 || p > 65535 || [4001, 4002, 4096].includes(p)) ||
      new Set(values).size !== 3) refuse();
  return result;
}

function sandboxPaths(sb: string): void {
  if (!/^\/(private\/tmp|private\/var\/folders|var\/folders)\/.+/.test(sb)) refuse();
  ownedPath(sb, true);
  if ((lstatSync(sb).mode & 0o777) !== 0o700) refuse();
  for (const path of ['home', 'home/.config', 'home/.config/opencode', 'home/.local',
    'home/.local/share', 'home/.local/share/opencode', 'vault', 'live-artifacts']) ownedPath(join(sb, path), true);
  for (const path of ['rhythm.db', 'home/.config/opencode/opencode.json']) ownedPath(join(sb, path));
  const config = JSON.parse(readFileSync(join(sb, 'home/.config/opencode/opencode.json'), 'utf8'));
  if (!config.mcp || typeof config.mcp !== 'object' || Array.isArray(config.mcp) || !Object.keys(config.mcp).length ||
      Object.values(config.mcp).some(value => {
        const entry = value as { type?: unknown; command?: unknown } | null;
        return !entry || entry.type !== 'local' || !Array.isArray(entry.command) || !entry.command.length ||
          entry.command.some(arg => typeof arg !== 'string' || !arg.trim());
      })) refuse();
}

// macOS KERN_PROCARGS2 preserves NUL-delimited argv/environment. ps eww text
// cannot distinguish a real HOME from an argv/config string containing HOME=.
// Read only this recorded PID and emit only isolation fields, never credentials.
function launchArguments(pid: number): { executable: string; argv: string[]; env: Record<string, string> } {
  if (process.platform !== 'darwin' || !Number.isSafeInteger(pid) || pid <= 1) refuse();
  return JSON.parse(osRead('/usr/bin/python3', ['-I', '-c', String.raw`
import ctypes, json, struct, sys
libc = ctypes.CDLL('/usr/lib/libSystem.B.dylib', use_errno=True)
mib = (ctypes.c_int * 3)(1, 49, int(sys.argv[1]))
size = ctypes.c_size_t(1024 * 1024)
buf = ctypes.create_string_buffer(size.value)
if libc.sysctl(mib, 3, buf, ctypes.byref(size), None, 0) != 0:
    raise OSError(ctypes.get_errno(), 'process provenance unavailable')
raw = buf.raw[:size.value]
argc = struct.unpack_from('i', raw)[0]
if not 0 < argc < 4096: raise ValueError('invalid argv count')
pos = 4
end = raw.index(b'\0', pos)
executable = raw[pos:end].decode()
pos = end
while pos < len(raw) and raw[pos] == 0: pos += 1
argv = []
for _ in range(argc):
    end = raw.index(b'\0', pos)
    argv.append(raw[pos:end].decode())
    pos = end + 1
keys = set('HOME XDG_CONFIG_HOME XDG_DATA_HOME XDG_CACHE_HOME OPENCODE_DB OPENCODE_CONFIG OPENCODE_CONFIG_DIR OPENCODE_CONFIG_CONTENT DB_PATH PORT RHYTHM_OPENCODE_ENGINE_PORT RHYTHM_MOBILE_GATEWAY_PORT RHYTHM_SANDBOX_ENGINE_PARENT_PID RHYTHM_SANDBOX_ENGINE_PARENT_START RHYTHM_SANDBOX_DIR RHYTHM_SANDBOX_API_PORT RHYTHM_SANDBOX_ENGINE_PORT RHYTHM_SANDBOX_GATEWAY_PORT RHYTHM_SANDBOX_HOLDER_BINDING'.split())
env = {}
for item in raw[pos:].split(b'\0'):
    if not item: continue
    key, sep, value = item.decode().partition('=')
    if key in keys:
        if not sep or key in env: raise ValueError('ambiguous environment')
        env[key] = value
print(json.dumps(dict(executable=executable, argv=argv, env=env)))
`, String(pid)]));
}

function isolation(sb: string, port: number, actual: Record<string, string>): void {
  const envelope = ports(port);
  const expected = { HOME: join(sb, 'home'), XDG_CONFIG_HOME: join(sb, 'home/.config'),
    XDG_DATA_HOME: join(sb, 'home/.local/share'), XDG_CACHE_HOME: join(sb, 'home/.cache'),
    OPENCODE_DB: 'opencode-rhythm-sandbox.db', DB_PATH: join(sb, 'rhythm.db'),
    PORT: String(envelope.api), RHYTHM_OPENCODE_ENGINE_PORT: String(port),
    RHYTHM_MOBILE_GATEWAY_PORT: String(envelope.gateway) };
  if (Object.entries(expected).some(([key, value]) => actual[key] !== value) ||
      actual.OPENCODE_CONFIG !== undefined || actual.OPENCODE_CONFIG_DIR !== undefined ||
      (actual.OPENCODE_CONFIG_CONTENT !== undefined && actual.OPENCODE_CONFIG_CONTENT !== '{}')) refuse();
}

export function validateSandboxApiOwnership(sb: string, port: number, pid: number): void {
  sandboxPaths(sb);
  ownedPath(join(sb, 'api_server.pid'));
  if (readFileSync(join(sb, 'api_server.pid'), 'utf8').trim() !== String(pid) || ps(pid, 'uid') !== String(process.getuid?.())) refuse();
  const launch = launchArguments(pid);
  isolation(sb, port, launch.env);
  const executable = osRead('/usr/sbin/lsof', ['-a', '-p', String(pid), '-d', 'txt', '-Fn'])
    .split('\n').find(line => line.startsWith('n'))?.slice(1);
  if (!executable || realpathSync(launch.executable) !== executable || !executable.endsWith('/node')) refuse();
  const script = resolve(__dirname, '../../dist/server.js');
  if (launch.argv.length !== 4 || launch.argv[1] !== script ||
      launch.argv[2] !== '--parent-pid=1' || launch.argv[3] !== `--rhythm-sandbox=${sb}`) refuse();
}

function engineProvenance(sb: string, port: number) {
  sandboxPaths(sb);
  const envelope = ports(port);
  const record = join(sb, 'opencode_engine.pid');
  ownedPath(record);
  const raw = readFileSync(record, 'utf8').trim();
  if (!/^\d+$/.test(raw)) refuse();
  const pid = Number(raw);
  if (osRead('/usr/sbin/lsof', ['-tiTCP:' + port, '-sTCP:LISTEN']).trim() !== raw ||
      ps(pid, 'uid') !== String(process.getuid?.())) refuse();
  const launch = launchArguments(pid);
  isolation(sb, port, launch.env);
  const binary = join(process.env.RHYTHM_OPENCODE_BIN_DIR ?? '', 'opencode');
  ownedPath(binary);
  const executable = osRead('/usr/sbin/lsof', ['-a', '-p', raw, '-d', 'txt', '-Fn'])
    .split('\n').find(line => line.startsWith('n'))?.slice(1);
  if (executable !== binary || realpathSync(launch.executable) !== binary) refuse();
  const expectedArgs = ['serve', '--hostname=127.0.0.1', `--port=${port}`,
    '--cors=http://127.0.0.1:4175', '--cors=rhythm://app'];
  if (JSON.stringify(launch.argv.slice(1)) !== JSON.stringify(expectedArgs)) refuse();
  const store = join(sb, 'home/.local/share/opencode/opencode-rhythm-sandbox.db');
  ownedPath(store);
  const files = osRead('/usr/sbin/lsof', ['-a', '-p', raw, '-Fn']).split('\n');
  if (!files.includes('n' + store)) refuse();
  const config = join(sb, 'home/.config/opencode/opencode.json');
  const binaryInfo = lstatSync(binary);
  return { pid, start: ps(pid, 'lstart'), ports: envelope, launch,
    binary: { path: binary, dev: binaryInfo.dev, ino: binaryInfo.ino },
    config: { path: config, sha256: digest(readFileSync(config)) }, store };
}

// Bind the observed launch to its still-live owned API before the FIRST crash.
// A preserved/orphaned engine without this record is held, never adopted.
export function recordSandboxEngineOwnership(sb: string, port: number, apiPid: number): void {
  const file = ownershipFile(sb);
  if (lstatExists(file)) { validateSandboxEngineOwnership(sb, port); return; }
  validateSandboxApiOwnership(sb, port, apiPid);
  const state = engineProvenance(sb, port);
  if (ps(state.pid, 'ppid') !== String(apiPid) ||
      state.launch.env.RHYTHM_SANDBOX_ENGINE_PARENT_PID !== String(apiPid) ||
      state.launch.env.RHYTHM_SANDBOX_ENGINE_PARENT_START !== ps(apiPid, 'lstart')) refuse();
  writeFileSync(file, JSON.stringify({ state, parent: { pid: apiPid, start: ps(apiPid, 'lstart') } }) + '\n', { flag: 'wx', mode: 0o600 });
}

function lstatExists(path: string): boolean {
  try { lstatSync(path); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export function validateSandboxEngineOwnership(sb: string, port: number): void {
  const file = ownershipFile(sb);
  ownedPath(file);
  if ((lstatSync(file).mode & 0o777) !== 0o600) refuse();
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  const observed = engineProvenance(sb, port);
  if (!saved.parent || !Number.isSafeInteger(saved.parent.pid) || !saved.parent.start ||
      String(saved.parent.pid) !== observed.launch.env.RHYTHM_SANDBOX_ENGINE_PARENT_PID ||
      saved.parent.start !== observed.launch.env.RHYTHM_SANDBOX_ENGINE_PARENT_START ||
      JSON.stringify(saved.state) !== JSON.stringify(observed)) refuse();
}

function holderIdentity(pid: number, root: string): string {
  ownedPath(root, true);
  const script = join(root, 'tools/dev/sandbox.sh');
  ownedPath(script);
  const raw = String(pid);
  const start = ps(pid, 'lstart');
  const launch = launchArguments(pid);
  const executable = osRead('/usr/sbin/lsof', ['-a', '-p', raw, '-d', 'txt', '-Fn'])
    .split('\n').find(line => line.startsWith('n'))?.slice(1);
  const cwd = osRead('/usr/sbin/lsof', ['-a', '-p', raw, '-d', 'cwd', '-Fn'])
    .split('\n').find(line => line.startsWith('n'))?.slice(1);
  if (executable !== realpathSync('/bin/bash') || realpathSync(launch.executable) !== executable ||
      launch.argv.length !== 4 || !['/bin/bash', 'bash'].includes(launch.argv[0]) ||
      ![script, 'tools/dev/sandbox.sh', './tools/dev/sandbox.sh'].includes(launch.argv[1]) ||
      launch.argv[2] !== 'up' || launch.argv[3] !== '--foreground' || cwd !== root) refuse();
  if (ps(pid, 'lstart') !== start) refuse();
  return start;
}

function validateHolderBinding(sb: string, port: number, pid: number, root: string, engineEnv: Record<string, string>): string {
  const start = holderIdentity(pid, root);
  // macOS's platform Bash can expose no environment through KERN_PROCARGS2.
  // Require a NONEMPTY exec-observed seal from the verified engine instead;
  // neither {} nor a caller/file declaration is an ownership exemption.
  const expected = JSON.stringify({ version: 1, pid, start, root, sandbox: sb, ports: ports(port) });
  if (engineEnv.RHYTHM_SANDBOX_HOLDER_BINDING !== expected) refuse();
  return start;
}

// Normal request to a proven holder, never a PID signal or title/orphan adoption.
export function requestSandboxHolderShutdown(sb: string, port: number, liveApiPid: number, root: string): void {
  validateSandboxEngineOwnership(sb, port);
  const record = join(sb, 'foreground_holder.pid');
  ownedPath(record);
  const raw = readFileSync(record, 'utf8').trim();
  if (!/^[1-9][0-9]*$/.test(raw)) refuse();
  const pid = Number(raw);
  const start = validateHolderBinding(sb, port, pid, root, engineProvenance(sb, port).launch.env);
  if (lstatExists(join(sb, 'lifecycle'))) {
    // Existing immutable intent/start/store/config/binary guards, including
    // held failure: an explicit stop is not a work retry or authority grant.
    osRead('/usr/bin/python3', ['-I', '-B', join(root, 'tools/dev/sandbox_api_recovery.py'),
      'validate-holder', sb, raw, start]);
  } else {
    validateSandboxApiOwnership(sb, port, liveApiPid);
    if (ps(liveApiPid, 'ppid') !== raw) refuse();
  }
  validateSandboxEngineOwnership(sb, port);
  if (readFileSync(record, 'utf8').trim() !== raw || ps(pid, 'lstart') !== start) refuse();
  const marker = join(sb, 'shutdown.requested');
  if (lstatExists(marker)) { ownedPath(marker); return; } // Preserve bytes/inode.
  const fd = openSync(marker, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

// Only the owned API stamps these immediately before the SDK spawn. The actual
// engine's kernel-observed launch environment survives API death/reparenting;
// recovery metadata cannot supply its own parent evidence.
export function prepareSandboxEngineLaunch(port: number): void {
  const marker = process.argv.find(arg => arg.startsWith('--rhythm-sandbox='));
  if (!marker) return;
  if (process.env.NODE_ENV === 'production') refuse();
  const sb = marker.slice('--rhythm-sandbox='.length);
  validateSandboxApiOwnership(sb, port, process.pid);
  process.env.RHYTHM_SANDBOX_ENGINE_PARENT_PID = String(process.pid);
  process.env.RHYTHM_SANDBOX_ENGINE_PARENT_START = ps(process.pid, 'lstart');
  delete process.env.RHYTHM_SANDBOX_HOLDER_BINDING;
  const holder = join(sb, 'foreground_holder.pid');
  if (lstatExists(holder)) {
    ownedPath(holder);
    const raw = readFileSync(holder, 'utf8').trim();
    if (!/^[1-9][0-9]*$/.test(raw) || ps(process.pid, 'ppid') !== raw) refuse();
    const pid = Number(raw);
    const root = osRead('/usr/sbin/lsof', ['-a', '-p', raw, '-d', 'cwd', '-Fn'])
      .split('\n').find(line => line.startsWith('n'))?.slice(1);
    if (!root) return refuse();
    const start = holderIdentity(pid, root);
    if (readFileSync(holder, 'utf8').trim() !== raw || ps(process.pid, 'ppid') !== raw) refuse();
    // Captured only by the proven actual API parent before SDK exec. The
    // engine's kernel environment and immutable ownership record retain it
    // across API death; arbitrary recovery files cannot manufacture this seal.
    process.env.RHYTHM_SANDBOX_HOLDER_BINDING = JSON.stringify({ version: 1, pid, start, root, sandbox: sb, ports: ports(port) });
  }
}

// ponytail: launcher-owned crash recovery only; not a general external-engine mode.
export function sandboxEngineAttachment(port: number): string | null {
  const raw = process.env.RHYTHM_SANDBOX_ATTACH_ENGINE_PID;
  if (raw === undefined) return null;
  const sb = process.env.RHYTHM_SANDBOX_DIR ?? '';
  if (process.env.NODE_ENV === 'production' || !/^\d+$/.test(raw) || port === 4096 ||
      !/^\/(private\/tmp|private\/var\/folders|var\/folders)\/.+/.test(sb) ||
      !process.argv.includes(`--rhythm-sandbox=${sb}`) ||
      process.env.HOME !== join(sb, 'home') || process.env.DB_PATH !== join(sb, 'rhythm.db') ||
      process.env.OPENCODE_DB !== 'opencode-rhythm-sandbox.db') return refuse();
  try {
    isolation(sb, port, process.env as Record<string, string>);
    if (readFileSync(join(sb, 'opencode_engine.pid'), 'utf8').trim() !== raw) refuse();
    validateSandboxEngineOwnership(sb, port);
  } catch { return refuse(); }
  return `http://127.0.0.1:${port}`;
}

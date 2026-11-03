/** Parent-side macOS provenance for one disposable engine listener. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';

type ProcessIdentity = { pid: number; ppid: number; uid: number; sec: number; usec: number };
const metadataScript = String.raw`
import ctypes,json,os,sys
pid=int(sys.argv[1]);
if not 1 < pid < 2147483648: raise ValueError('invalid pid')
class Bsd(ctypes.Structure):
    _fields_=[(n,ctypes.c_uint32) for n in ('flags','status','xstatus','pid','ppid','uid','gid','ruid','rgid','svuid','svgid','reserved')]+[('comm',ctypes.c_char*16),('name',ctypes.c_char*32)]+[(n,ctypes.c_uint32) for n in ('nfiles','pgid','jobc','tdev','tpgid')]+[('nice',ctypes.c_int32),('sec',ctypes.c_uint64),('usec',ctypes.c_uint64)]
lib=ctypes.CDLL('/usr/lib/libproc.dylib',use_errno=True)
lib.proc_pidinfo.argtypes=[ctypes.c_int,ctypes.c_int,ctypes.c_uint64,ctypes.c_void_p,ctypes.c_int]
lib.proc_pidinfo.restype=ctypes.c_int
b=Bsd()
if ctypes.sizeof(b)!=136 or lib.proc_pidinfo(pid,3,0,ctypes.byref(b),136)!=136:
    raise OSError(ctypes.get_errno(),'process metadata unavailable')
if b.pid!=pid or b.uid!=os.getuid() or not b.sec or b.usec>=1000000 or b.status==5:
    raise ValueError('foreign or exited process')
print(json.dumps(dict(pid=b.pid,ppid=b.ppid,uid=b.uid,sec=b.sec,usec=b.usec)))
`;

function identity(pid: number): ProcessIdentity {
  if (process.platform !== 'darwin' || !Number.isSafeInteger(pid) || pid <= 1)
    throw Error('Private engine process attestation requires macOS');
  const output = execFileSync('/usr/bin/python3', ['-I', '-c', metadataScript, String(pid)],
    { encoding: 'utf8', timeout: 5000, maxBuffer: 4096 });
  const info = JSON.parse(output) as ProcessIdentity;
  if (info.pid !== pid || info.uid !== process.getuid?.() ||
      !Number.isSafeInteger(info.ppid) || !Number.isSafeInteger(info.sec) ||
      !Number.isSafeInteger(info.usec)) throw Error('Private process identity changed');
  return info;
}

function same(a: ProcessIdentity, b: ProcessIdentity): boolean {
  return a.pid === b.pid && a.ppid === b.ppid && a.uid === b.uid &&
    a.sec === b.sec && a.usec === b.usec;
}

export function attestPrivateEngineListener(input: {
  enginePort: number; workerPid: number; pinnedBinary: string;
  binarySha256: string;
}): { enginePid: number; engineStart: string; workerStart: string } {
  const { enginePort, workerPid } = input;
  if (!Number.isInteger(enginePort) || enginePort < 1024 || enginePort > 65535 ||
      [4000, 4001, 4002, 4096, 4098].includes(enginePort) ||
      !/^[a-f0-9]{64}$/.test(input.binarySha256))
    throw Error('Private engine port or binary identity invalid');
  const binary = realpathSync(input.pinnedBinary);
  const file = lstatSync(input.pinnedBinary);
  if (!file.isFile() || file.uid !== process.getuid?.() || binary !== input.pinnedBinary ||
      createHash('sha256').update(readFileSync(binary)).digest('hex') !== input.binarySha256)
    throw Error('Pinned private engine binary changed');
  const workerBefore = identity(workerPid);
  const raw = execFileSync('/usr/sbin/lsof', ['-nP', `-tiTCP:${enginePort}`, '-sTCP:LISTEN'],
    { encoding: 'utf8', timeout: 5000, maxBuffer: 4096 }).trim();
  if (!/^\d+$/.test(raw)) throw Error('Private engine listener is ambiguous');
  const enginePid = Number(raw);
  if (enginePid === workerPid) throw Error('Private engine listener is not a child process');
  const engineBefore = identity(enginePid);
  let cursor = engineBefore;
  const visited = new Set<number>();
  let descendant = false;
  for (let depth = 0; depth < 12; depth++) {
    if (cursor.ppid === workerPid) { descendant = true; break; }
    if (cursor.ppid <= 1 || visited.has(cursor.ppid)) break;
    visited.add(cursor.ppid);
    cursor = identity(cursor.ppid);
  }
  if (!descendant) throw Error('Private listener is not descended from owned worker');
  const text = execFileSync('/usr/sbin/lsof', ['-a', '-p', raw, '-d', 'txt', '-Fn'],
    { encoding: 'utf8', timeout: 5000, maxBuffer: 8192 });
  const executable = text.split('\n').find(line => line.startsWith('n'))?.slice(1);
  if (executable !== binary) throw Error('Private listener executable is not pinned binary');
  const workerAfter = identity(workerPid);
  const engineAfter = identity(enginePid);
  if (!same(workerBefore, workerAfter) || !same(engineBefore, engineAfter) ||
      createHash('sha256').update(readFileSync(binary)).digest('hex') !== input.binarySha256)
    throw Error('Private engine ownership changed during attestation');
  return { enginePid, engineStart: `${engineBefore.sec}:${engineBefore.usec}`,
    workerStart: `${workerBefore.sec}:${workerBefore.usec}` };
}

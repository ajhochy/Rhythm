"""Versioned launcher recovery evidence; never signs, moves or signals a process."""
import hashlib
import ctypes
import json
import os
import pathlib
import stat
import struct
import time
import sys


def require(value, message):
    if not value:
        raise ValueError(message)


def digest(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()


def owned(path, directory=False):
    path = pathlib.Path(path)
    info = path.lstat()
    require(info.st_uid == os.getuid() and path.resolve() == path and
            (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)), 'unsafe recovery record')
    return info


def write_new(path, value):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(value, stream, sort_keys=True, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())


def kernel_start(pid):
    require(sys.platform == 'darwin' and type(pid) is int and 1 < pid < 2147483648, 'invalid process identity')
    class Bsd(ctypes.Structure):
        _fields_ = [(n, ctypes.c_uint32) for n in ('flags', 'status', 'xstatus', 'pid', 'ppid', 'uid', 'gid',
                   'ruid', 'rgid', 'svuid', 'svgid', 'reserved')] + [('comm', ctypes.c_char * 16),
                   ('name', ctypes.c_char * 32)] + [(n, ctypes.c_uint32) for n in ('nfiles', 'pgid', 'jobc',
                   'tdev', 'tpgid')] + [('nice', ctypes.c_int32), ('sec', ctypes.c_uint64), ('usec', ctypes.c_uint64)]
    lib = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
    lib.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64, ctypes.c_void_p, ctypes.c_int]
    lib.proc_pidinfo.restype = ctypes.c_int
    def read():
        b = Bsd()
        require(ctypes.sizeof(b) == 136 and lib.proc_pidinfo(pid, 3, 0, ctypes.byref(b), 136) == 136,
                'kernel process metadata unavailable')
        require(b.pid == pid and b.uid == os.getuid() and b.sec > 0 and b.usec < 1000000 and b.status != 5,
                'missing or foreign process')
        return b
    before, after = read(), read()
    require((before.pid, before.uid, before.ppid, before.sec, before.usec) ==
            (after.pid, after.uid, after.ppid, after.sec, after.usec), 'process changed during inspection')
    return time.strftime('%a %b %e %H:%M:%S %Y', time.localtime(before.sec))


def kernel_arguments_match(pid, required):
    before = kernel_start(pid)  # validates real current own UID/PID/start first
    lib = ctypes.CDLL('/usr/lib/libSystem.B.dylib', use_errno=True)
    lib.sysctl.argtypes = [ctypes.POINTER(ctypes.c_int), ctypes.c_uint, ctypes.c_void_p,
                          ctypes.POINTER(ctypes.c_size_t), ctypes.c_void_p, ctypes.c_size_t]
    lib.sysctl.restype = ctypes.c_int
    mib = (ctypes.c_int * 3)(1, 49, pid)
    size = ctypes.c_size_t(1024 * 1024)
    buf = ctypes.create_string_buffer(size.value)
    require(lib.sysctl(mib, 3, buf, ctypes.byref(size), None, 0) == 0, 'kernel argv unavailable')
    raw = buf.raw[:size.value]
    argc = struct.unpack_from('i', raw)[0]
    require(0 < argc < 4096, 'invalid kernel argv count')
    pos = raw.index(b'\0', 4)
    while pos < len(raw) and raw[pos] == 0:
        pos += 1
    argv = []
    for _ in range(argc):
        end = raw.index(b'\0', pos)
        argv.append(raw[pos:end].decode())
        pos = end + 1
    require(kernel_start(pid) == before, 'process changed during argv inspection')
    require(required and all(value in argv for value in required), 'process argv ownership mismatch')


def verify_archived_pid(source, archive, identity):
    source, archive = pathlib.Path(source), pathlib.Path(archive)
    require(not source.exists() and not source.is_symlink() and archive.exists(), 'reviewed PID archive incomplete')
    info = owned(archive)
    require((info.st_dev, info.st_ino) == (identity['dev'], identity['ino'])
            and digest(archive) == identity['sha256'], 'PID archive identity changed')


def sandbox(path):
    path = pathlib.Path(path)
    info = owned(path, True)
    require(str(path).startswith('/private/tmp/') and stat.S_IMODE(info.st_mode) == 0o700, 'unsafe recovery sandbox')
    return path


def latest(sb):
    folder = sb / 'lifecycle'
    owned(folder, True)
    paths = sorted(folder.glob('api-generation-[0-9][0-9][0-9][0-9][0-9][0-9]'))
    require(paths, 'no recovery intent')
    generation = paths[-1]
    owned(generation, True)
    intent = generation / 'intent.json'
    owned(intent)
    return generation, json.loads(intent.read_text())


def stable_engine(sb, intent):
    record = sb / 'opencode_engine.ownership.json'
    owned(record)
    require(digest(record) == intent['engine_ownership_sha256'], 'immutable engine ownership changed')
    state = json.loads(record.read_text())['state']
    binary = pathlib.Path(state['binary']['path'])
    store = pathlib.Path(state['store'])
    config = pathlib.Path(state['config']['path'])
    b, s = owned(binary), owned(store)
    require((b.st_dev, b.st_ino) == (intent['binary_dev'], intent['binary_ino'])
            and digest(binary) == intent['binary_sha256']
            and (s.st_dev, s.st_ino) == (intent['store_dev'], intent['store_ino'])
            and digest(config) == intent['config_sha256']
            and (sb / 'opencode_engine.pid').read_text().strip() == str(intent['engine_pid'])
            and (sb / 'foreground_holder.pid').read_text().strip() == str(intent['holder_pid'])
            and kernel_start(intent['holder_pid'])
                == intent['holder_start'], 'engine/store/holder binding changed')


def prepare(sb, api_pid):
    pidfile = sb / 'api_server.pid'
    info = owned(pidfile)
    require(pidfile.read_text().strip() == str(api_pid), 'current API PID changed')
    record = sb / 'opencode_engine.ownership.json'
    owned(record)
    state = json.loads(record.read_text())['state']
    holder = sb / 'foreground_holder.pid'
    owned(holder)
    folder = sb / 'lifecycle'
    if not folder.exists():
        folder.mkdir(mode=0o700)
    owned(folder, True)
    previous = sorted(folder.glob('api-generation-*'))
    if previous:
        prior, _ = latest(sb)
        require((prior / 'ready.json').is_file(), 'previous recovery incomplete; no automatic retry')
    generation = folder / ('api-generation-' + str(len(previous) + 1).zfill(6))
    generation.mkdir(mode=0o700)
    binary, store = pathlib.Path(state['binary']['path']), pathlib.Path(state['store'])
    b, s = owned(binary), owned(store)
    holder_pid = int(holder.read_text().strip())
    holder_start = kernel_start(holder_pid)
    api_start = kernel_start(api_pid)
    require(holder_start and api_start, 'API/holder start identity unavailable')
    intent = {'old_api_pid': int(api_pid), 'holder_pid': int(holder.read_text().strip()),
              'old_api_start': api_start, 'holder_start': holder_start,
              'engine_pid': int(state['pid']), 'engine_start': state['start'],
              'engine_ownership_sha256': digest(record), 'binary_sha256': digest(binary),
              'binary_dev': b.st_dev, 'binary_ino': b.st_ino, 'store_dev': s.st_dev, 'store_ino': s.st_ino,
              'config_sha256': digest(state['config']['path']),
              'pid_identity': {'dev': info.st_dev, 'ino': info.st_ino, 'sha256': digest(pidfile)},
              'archive_source': str(pidfile), 'archive_destination': str(generation / 'previous-api_server.pid'),
              'operation': 'renameatx_np(RENAME_EXCL)', 'approval_issued': False}
    write_new(generation / 'intent.json', intent)
    stable_engine(sb, intent)


def main(action, path, *args):
    sb = sandbox(path)
    if action == 'prepare':
        require(len(args) == 1 and type(args[0]) is str and args[0].isascii()
                and args[0].isdecimal() and args[0][0] != '0' and len(args[0]) <= 10,
                'invalid canonical prepare PID argument')
        pid = int(args[0])
        require(1 < pid < 2147483648, 'invalid prepare PID range')
        prepare(sb, pid)
        return
    generation, intent = latest(sb)
    stable_engine(sb, intent)
    if action == 'validate-holder':
        require(len(args) == 2 and args[0] == str(intent['holder_pid'])
                and args[1] == intent['holder_start'], 'wrong foreground holder identity')
    elif action == 'await-archive':
        require(int(args[0]) == intent['old_api_pid'], 'wrong old API')
        write_new(generation / 'await-archive.json', {'old_api_pid': intent['old_api_pid'], 'held': True})
    elif action == 'archive-ready':
        require((generation / 'await-archive.json').is_file(), 'archive phase not armed')
        verify_archived_pid(intent['archive_source'], intent['archive_destination'], intent['pid_identity'])
    elif action == 'replacement':
        verify_archived_pid(intent['archive_source'], intent['archive_destination'], intent['pid_identity'])
        pid = int(args[0])
        require(pid > 1 and pid not in (intent['old_api_pid'], intent['engine_pid'], intent['holder_pid']), 'invalid replacement API')
        # Canonical PID can only be created AFTER retained exact archival.
        fd = os.open(sb / 'api_server.pid', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w') as stream:
            stream.write(str(pid) + '\n')
            stream.flush()
            os.fsync(stream.fileno())
        write_new(generation / 'replacement-launch.json', {'pid': pid, 'start': args[1], 'old_api_pid': intent['old_api_pid']})
    elif action == 'ready':
        replacement = json.loads((generation / 'replacement-launch.json').read_text())
        require((sb / 'api_server.pid').read_text().strip() == str(replacement['pid']), 'replacement PID changed')
        write_new(generation / 'ready.json', replacement)
    elif action == 'holder-state':
        require(int(args[0]) == intent['old_api_pid'], 'holder recovery intent does not bind exited API')
        require(not (generation / 'held-failure.json').exists(), 'recovery held after failure')
        if (generation / 'ready.json').exists():
            print(json.loads((generation / 'ready.json').read_text())['pid'])
        else:
            print('pending')
    elif action == 'failed':
        if not (generation / 'held-failure.json').exists():
            write_new(generation / 'held-failure.json', {'held': True, 'engine_not_signalled': True})
    else:
        raise ValueError('unknown recovery action')


if __name__ == '__main__':
    try:
        if sys.argv[1] == 'inspect-start':
            print(kernel_start(int(sys.argv[2])))
        elif sys.argv[1] == 'inspect-argv':
            kernel_arguments_match(int(sys.argv[2]), sys.argv[3:])
        else:
            main(*sys.argv[1:])
    except Exception as error:
        print('sandbox recovery refused: ' + (str(error) if isinstance(error, ValueError) else type(error).__name__), file=sys.stderr)
        sys.exit(1)

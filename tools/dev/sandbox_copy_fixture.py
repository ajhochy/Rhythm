"""Copy an approved read-only fixture without unlinking a copy-time journal."""
import hashlib
import os
import pathlib
import sqlite3
import stat
import sys


def copy(source, destination, wal_bootstrap=False):
    source, destination = pathlib.Path(source), pathlib.Path(destination)
    parent = destination.parent
    info = parent.lstat()
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid()
            or stat.S_IMODE(info.st_mode) != 0o700 or parent.resolve() != parent):
        raise ValueError('copy requires an owned canonical destination directory')
    if source.is_symlink() or os.access(source, os.W_OK) or not source.is_file():
        raise ValueError('copy requires a read-only regular source fixture')
    before = hashlib.sha256(source.read_bytes()).digest()
    # Exclusive creation rejects both an existing file and dangling symlink.
    fd = os.open(destination, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    os.close(fd)
    with sqlite3.connect(source.as_uri() + '?mode=ro', uri=True) as src:
        with sqlite3.connect(destination) as dst:
            # ponytail: MEMORY is COPY-only; reopened runtime keeps normal durability.
            dst.execute('PRAGMA journal_mode=MEMORY')
            dst.execute('PRAGMA temp_store=MEMORY')
            src.backup(dst)
            tables = src.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall()
            if tables != dst.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall():
                raise ValueError('copy table verification failed')
            for (name,) in tables:
                sql = 'SELECT count(*) FROM "' + name.replace('"', '""') + '"'
                if src.execute(sql).fetchone() != dst.execute(sql).fetchone():
                    raise ValueError('copy row-count verification failed')
            if wal_bootstrap:
                # COPY/bootstrap-only MEMORY; the actual API runtime starts in WAL.
                version = src.execute('PRAGMA user_version').fetchone()[0]
                dst.execute('PRAGMA user_version=' + str(version))
                if dst.execute('PRAGMA journal_mode=WAL').fetchone() != ('wal',):
                    raise ValueError('copy WAL bootstrap failed')
                if dst.execute('PRAGMA integrity_check').fetchone() != ('ok',):
                    raise ValueError('copy WAL integrity failed')
        dst.close()
    src.close()
    if hashlib.sha256(source.read_bytes()).digest() != before:
        raise ValueError('source identity changed during copy')


if __name__ == '__main__':
    source, destination, *options = sys.argv[1:]
    if options not in ([], ['--wal-bootstrap']):
        raise ValueError('unsupported copy option')
    copy(source, destination, bool(options))

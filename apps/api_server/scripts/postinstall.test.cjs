const assert = require("node:assert/strict");
const { test } = require("node:test");
const { ensureBetterSqlite3, main } = require("./postinstall.js");

// Hermetic stand-in for the real better-sqlite3 Database export: exercises
// the same probe/rebuild decision logic without touching the real installed
// module (real require() is environment-dependent).
class FakeWorkingDatabase {
  prepare() {
    return { get: () => ({ x: 1 }) };
  }
  close() {}
}
const workingLoadDatabase = () => FakeWorkingDatabase;

test("#1505-A: a working N-API prebuild is queried and never rebuilt", () => {
  const result = ensureBetterSqlite3({
    loadDatabase: workingLoadDatabase,
    rebuild: () => {
      assert.fail("a usable N-API prebuild must not require a compiler");
    },
  });

  assert.equal(result, "prebuild");
});

test("#1505-A: a failed package-entry query falls back to a rebuild, then re-verified", () => {
  let calls = 0;
  let rebuilds = 0;

  const result = ensureBetterSqlite3({
    loadDatabase: () => {
      calls += 1;
      if (calls === 1) throw new Error("synthetic native load failure");
      return FakeWorkingDatabase;
    },
    rebuild: () => {
      rebuilds += 1;
    },
  });

  assert.equal(result, "rebuilt");
  assert.equal(rebuilds, 1);
  assert.equal(calls, 2, "must re-probe after rebuilding, not trust the exit code alone");
});

test("#1505A-review: a rebuild that still can't run a query must not be reported as success", () => {
  let rebuilds = 0;

  assert.throws(
    () =>
      ensureBetterSqlite3({
        loadDatabase: () => {
          throw new Error("synthetic native load failure");
        },
        rebuild: () => {
          rebuilds += 1;
        },
      }),
    /better-sqlite3/i,
  );
  assert.equal(rebuilds, 1, "must attempt exactly one rebuild before giving up");
});

test("#1505A-review: SKIP_BETTER_SQLITE3_REBUILD=1 skips the probe/rebuild entirely", () => {
  const originalSkip = process.env.SKIP_BETTER_SQLITE3_REBUILD;
  process.env.SKIP_BETTER_SQLITE3_REBUILD = "1";
  let sentinelWritten = false;
  let exitCode;
  try {
    main({
      ensure: () => assert.fail("must not probe/rebuild when skipped"),
      writeSentinel: () => {
        sentinelWritten = true;
      },
      exit: (code) => {
        exitCode = code;
      },
    });
  } finally {
    if (originalSkip === undefined) delete process.env.SKIP_BETTER_SQLITE3_REBUILD;
    else process.env.SKIP_BETTER_SQLITE3_REBUILD = originalSkip;
  }

  assert.equal(sentinelWritten, false, "sentinel is only written on the non-skip path");
  assert.equal(exitCode, undefined);
});

test("#1505A-review: an unrecoverable failure exits non-zero with a message and skips the sentinel", () => {
  const originalSkip = process.env.SKIP_BETTER_SQLITE3_REBUILD;
  delete process.env.SKIP_BETTER_SQLITE3_REBUILD;
  const originalError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.join(" "));
  let sentinelWritten = false;
  let exitCode;
  try {
    main({
      ensure: () => {
        throw new Error("better-sqlite3 still cannot run a query after rebuild");
      },
      writeSentinel: () => {
        sentinelWritten = true;
      },
      exit: (code) => {
        exitCode = code;
      },
    });
  } finally {
    console.error = originalError;
    if (originalSkip === undefined) delete process.env.SKIP_BETTER_SQLITE3_REBUILD;
    else process.env.SKIP_BETTER_SQLITE3_REBUILD = originalSkip;
  }

  assert.equal(exitCode, 1);
  assert.equal(sentinelWritten, false);
  assert.ok(
    logged.some((line) => line.includes("better-sqlite3")),
    "must log an actionable message",
  );
});

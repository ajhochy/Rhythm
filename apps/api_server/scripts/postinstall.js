#!/usr/bin/env node
/*
 * Rhythm api_server postinstall.
 *
 * Two responsibilities:
 *   1. Make node-pty's prebuilt spawn-helper executable on macOS (it ships
 *      without the +x bit on some package mirrors).
 *   2. Prove better-sqlite3's N-API prebuild loads and executes a query under
 *      this Node. Fall back to a source rebuild only when that probe fails.
 *
 * We also write apps/api_server/.node-runtime.json with the install-time
 * Node path + ABI. The Flutter app reads this sentinel in dev so it spawns
 * the api_server with the same Node that better-sqlite3 was built against.
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function chmodNodePty() {
  for (const platform of ["darwin-arm64", "darwin-x64"]) {
    const helper = `node_modules/node-pty/prebuilds/${platform}/spawn-helper`;
    try {
      execSync(`chmod +x ${helper}`);
    } catch (_) {
      /* prebuild for that arch may not be installed; ignore */
    }
  }
}

function rebuildBetterSqlite3() {
  console.log(
    `[postinstall] Rebuilding better-sqlite3 against Node ${process.version} ` +
      `(execPath=${process.execPath}, ABI=${process.versions.modules}).`,
  );
  execSync("npm rebuild better-sqlite3 --build-from-source", {
    stdio: "inherit",
  });
}

function probeBetterSqlite3(Database) {
  const db = new Database(":memory:");
  try {
    const row = db.prepare("select 1 as x").get();
    if (row?.x !== 1) {
      throw new Error("better-sqlite3 query returned the wrong result");
    }
  } finally {
    db.close();
  }
}

function ensureBetterSqlite3({
  loadDatabase = () => require("better-sqlite3"),
  rebuild = rebuildBetterSqlite3,
} = {}) {
  try {
    probeBetterSqlite3(loadDatabase());
    console.log(
      `[postinstall] better-sqlite3 N-API prebuild works under Node ${process.version}; skipping source rebuild.`,
    );
    return "prebuild";
  } catch (err) {
    console.warn(
      `[postinstall] better-sqlite3 package-entry probe failed under Node ${process.version}; falling back to a source rebuild.`,
    );
    console.warn(err && err.message ? err.message : err);
    rebuild();

    // better-sqlite3 13 ships "gypfile": false with no install/postinstall
    // script, so `npm rebuild --build-from-source` can exit 0 without
    // compiling anything on a platform with no matching N-API prebuild.
    // Re-probe (a fresh require -- Node evicts a module from its cache when
    // it throws during load) instead of trusting the exec exit code alone.
    try {
      probeBetterSqlite3(loadDatabase());
    } catch (rebuildErr) {
      throw new Error(
        `better-sqlite3 still cannot run a query after ` +
          `'npm rebuild better-sqlite3 --build-from-source' under Node ${process.version} ` +
          `(execPath=${process.execPath}, ABI=${process.versions.modules}). This platform likely ` +
          `has no matching N-API prebuild and needs build tools (a C++ compiler, python3) available ` +
          `to node-gyp. Rebuild error: ${rebuildErr && rebuildErr.message ? rebuildErr.message : rebuildErr}`,
      );
    }

    console.log(
      `[postinstall] better-sqlite3 works under Node ${process.version} after a source rebuild.`,
    );
    return "rebuilt";
  }
}

function writeRuntimeSentinel() {
  const sentinel = {
    nodePath: process.execPath,
    nodeVersion: process.version,
    abi: process.versions.modules,
    generatedAt: new Date().toISOString(),
  };
  const dest = path.join(__dirname, "..", ".node-runtime.json");
  fs.writeFileSync(dest, JSON.stringify(sentinel, null, 2) + "\n");
  console.log(`[postinstall] Wrote ${dest}`);
}

function main({
  ensure = ensureBetterSqlite3,
  writeSentinel = writeRuntimeSentinel,
  exit = process.exit,
} = {}) {
  chmodNodePty();

  // Skip the rebuild + sentinel when SKIP_BETTER_SQLITE3_REBUILD is set so
  // CI can opt out (e.g. when prebuilds are known good and rebuild would
  // need toolchains that aren't present).
  if (process.env.SKIP_BETTER_SQLITE3_REBUILD === "1") {
    console.log("[postinstall] SKIP_BETTER_SQLITE3_REBUILD=1, skipping rebuild.");
    return;
  }

  try {
    ensure();
  } catch (err) {
    console.error(
      "[postinstall] better-sqlite3 load/rebuild failed. Server will likely fail to start.",
    );
    console.error(err && err.message ? err.message : err);
    exit(1);
    return;
  }

  writeSentinel();
}

module.exports = {
  ensureBetterSqlite3,
  probeBetterSqlite3,
  main,
};

if (require.main === module) {
  main();
}

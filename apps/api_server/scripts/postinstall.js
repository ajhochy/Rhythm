#!/usr/bin/env node
/*
 * Rhythm api_server postinstall.
 *
 * Two responsibilities:
 *   1. Make node-pty's prebuilt spawn-helper executable on macOS (it ships
 *      without the +x bit on some package mirrors).
 *   2. Force-rebuild better-sqlite3 against the Node binary that is running
 *      this script. Prebuild-install can pick a binary that mismatches the
 *      Node version the Flutter desktop app spawns the api_server with,
 *      which produces a NODE_MODULE_VERSION error and kills the server
 *      before it can bind to :4001. Tracked as issue #585.
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

function main() {
  chmodNodePty();

  // Skip the rebuild + sentinel when SKIP_BETTER_SQLITE3_REBUILD is set so
  // CI can opt out (e.g. when prebuilds are known good and rebuild would
  // need toolchains that aren't present).
  if (process.env.SKIP_BETTER_SQLITE3_REBUILD === "1") {
    console.log("[postinstall] SKIP_BETTER_SQLITE3_REBUILD=1, skipping rebuild.");
    return;
  }

  try {
    rebuildBetterSqlite3();
  } catch (err) {
    console.error(
      "[postinstall] better-sqlite3 rebuild failed. Server will likely fail to start.",
    );
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  }

  writeRuntimeSentinel();
}

main();

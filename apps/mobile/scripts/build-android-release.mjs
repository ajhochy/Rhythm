#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

import { runAndroidReleaseBuild } from './android-signing-security.mjs';

export { runAndroidReleaseBuild };

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    runAndroidReleaseBuild();
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Android release build failed',
    );
    process.exitCode = 1;
  }
}

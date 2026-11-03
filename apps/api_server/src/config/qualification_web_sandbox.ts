import path from 'node:path';

/** Called only after the existing qualification authority has validated startup. */
export function qualificationWebSandboxOverrides(root: string, runtime: NodeJS.ProcessEnv): Record<string, string> | null {
  if (runtime.RHYTHM_SANDBOX_WEB_PAID === undefined) return null;
  const home = path.join(root, 'home');
  const expected = { RHYTHM_SANDBOX_WEB_PAID: '1', RHYTHM_SANDBOX_DIR: root, RHYTHM_WEB_HOST: '1',
    RHYTHM_QUALIFICATION_FIXTURE_MANIFEST: path.join(root, 'manifest.json'), HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'), XDG_DATA_HOME: path.join(home, '.local/share'), XDG_CACHE_HOME: path.join(home, '.cache') };
  if (Object.entries(expected).some(([key, value]) => runtime[key] !== value)
    || ['OPENCODE_CONFIG_DIR', 'OPENCODE_CONFIG', 'OPENCODE_CONFIG_CONTENT'].some(key => runtime[key] !== undefined)) {
    throw new Error('Qualification web sandbox layout invalid');
  }
  const config = path.join(home, '.config/opencode');
  return { XDG_CONFIG_HOME: expected.XDG_CONFIG_HOME, XDG_DATA_HOME: expected.XDG_DATA_HOME,
    XDG_CACHE_HOME: expected.XDG_CACHE_HOME, XDG_STATE_HOME: path.join(home, '.local/state'), OPENCODE_TEST_HOME: home,
    RHYTHM_OPENCODE_CONFIG_PATH: path.join(config, 'opencode.json'), RHYTHM_MANAGED_SKILLS_DIR: path.join(config, 'skills'),
    RHYTHM_MANAGED_COMMANDS_DIR: path.join(config, 'commands') };
}

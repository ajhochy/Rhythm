import { describe, expect, it } from 'vitest';
import { qualificationWebSandboxOverrides } from '../config/qualification_web_sandbox';

const root = '/private/tmp/rhythm-ai-fixture-synthetic';
const runtime = { RHYTHM_SANDBOX_WEB_PAID: '1', RHYTHM_SANDBOX_DIR: root, RHYTHM_WEB_HOST: '1',
  RHYTHM_QUALIFICATION_FIXTURE_MANIFEST: `${root}/manifest.json`, HOME: `${root}/home`,
  XDG_CONFIG_HOME: `${root}/home/.config`, XDG_DATA_HOME: `${root}/home/.local/share`, XDG_CACHE_HOME: `${root}/home/.cache` };
describe('qualification browser sandbox keeps exact canonical process layout', () => {
  it('preserves native qualification and generic sandbox defaults when the explicit mode is absent', () => {
    expect(qualificationWebSandboxOverrides(root, {})).toBeNull();
    expect(qualificationWebSandboxOverrides(root, { RHYTHM_SANDBOX_DIR: root })).toBeNull();
  });
  it('uses canonical sandbox paths without the forbidden OPENCODE_CONFIG_DIR override', () => {
    const paths = qualificationWebSandboxOverrides(root, runtime);
    expect(paths).toMatchObject({ XDG_CONFIG_HOME: `${root}/home/.config`, XDG_DATA_HOME: `${root}/home/.local/share`,
      XDG_CACHE_HOME: `${root}/home/.cache`, RHYTHM_OPENCODE_CONFIG_PATH: `${root}/home/.config/opencode/opencode.json`,
      RHYTHM_MANAGED_SKILLS_DIR: `${root}/home/.config/opencode/skills`, RHYTHM_MANAGED_COMMANDS_DIR: `${root}/home/.config/opencode/commands` });
    expect(paths).not.toHaveProperty('OPENCODE_CONFIG_DIR');
  });
  it.each(['RHYTHM_SANDBOX_DIR', 'RHYTHM_WEB_HOST', 'RHYTHM_QUALIFICATION_FIXTURE_MANIFEST', 'HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME'])('refuses mismatched %s', key => {
    expect(() => qualificationWebSandboxOverrides(root, { ...runtime, [key]: 'foreign' })).toThrow('Qualification web sandbox layout invalid');
  });
  it.each(['OPENCODE_CONFIG_DIR', 'OPENCODE_CONFIG', 'OPENCODE_CONFIG_CONTENT'])('refuses inherited %s', key => {
    expect(() => qualificationWebSandboxOverrides(root, { ...runtime, [key]: 'foreign' })).toThrow('Qualification web sandbox layout invalid');
  });
});

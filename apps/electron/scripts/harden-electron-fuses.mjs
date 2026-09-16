import { flipFuses, getCurrentFuseWire, FuseVersion, FuseV1Options, FuseState } from '@electron/fuses';

// Shared by ad-hoc packaging and Developer ID signing; no optional bypass.
export async function hardenElectronFuses(executable) {
  const config = {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    // The shipping payload is unpacked, not app.asar.
    [FuseV1Options.OnlyLoadAppFromAsar]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
  };
  const options = Object.keys(config).filter((option) => option !== 'version');
  const current = await getCurrentFuseWire(executable);
  if (current.version !== FuseVersion.V1 || options.some((option) =>
    current[option] !== FuseState.ENABLE && current[option] !== FuseState.DISABLE)) {
    throw new Error('Required Electron fuses are missing or unsupported');
  }
  await flipFuses(executable, config);
  const verified = await getCurrentFuseWire(executable);
  if (verified.version !== FuseVersion.V1 || options.some((option) => verified[option] !== FuseState.DISABLE)) {
    throw new Error('Required Electron fuses were not disabled');
  }
}

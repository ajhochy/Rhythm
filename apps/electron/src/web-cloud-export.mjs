import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** @param {string} file */
function protectedDestination(file) {
  if (!path.isAbsolute(file) || typeof process.getuid !== 'function') throw new Error('unavailable');
  const directory = path.dirname(file);
  const parent = fs.lstatSync(path.dirname(directory));
  if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== process.getuid() || (parent.mode & 0o022)) throw new Error('unavailable');
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, { mode: 0o700 });
  const dir = fs.lstatSync(directory);
  if (!dir.isDirectory() || dir.isSymbolicLink() || dir.uid !== process.getuid() || (dir.mode & 0o7777) !== 0o700) throw new Error('unavailable');
  const realDirectory = fs.realpathSync(directory);
  const repo = fs.realpathSync(path.resolve(import.meta.dirname, '../../..'));
  if (realDirectory === repo || realDirectory.startsWith(`${repo}${path.sep}`)) throw new Error('unavailable');
  try {
    const existing = fs.lstatSync(file);
    if (!existing.isFile() || existing.isSymbolicLink() || existing.uid !== process.getuid() || existing.nlink !== 1 || (existing.mode & 0o7777) !== 0o600) throw new Error('unavailable');
  } catch (error) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error; }
  return directory;
}

// Called only by the native application menu. No IPC, renderer-provided path,
// safeStorage read/decryption, network call, or token-bearing return value.
/** @param {{ electron: Pick<typeof import('electron'), 'Menu' | 'MenuItem'>,
 * getSession: () => { productionApiBase: string, userId: number, sessionToken: string } | null,
 * disabled: () => boolean, credentialPath: string,
 * dialog: Pick<import('electron').Dialog, 'showMessageBox'> }} options */
export function installWebCloudExportMenu({ electron, getSession, disabled, credentialPath, dialog }) {
  const { Menu, MenuItem } = electron;
  if (!Menu || !MenuItem) return;
  const current = () => disabled() ? null : getSession();
  let busy = false;
  const item = new MenuItem({
    label: 'Enable browser access on this Mac…', enabled: Boolean(current()),
    click: async () => {
      const session = current();
      if (busy || !session || !session.sessionToken?.trim() || !Number.isSafeInteger(session.userId) || session.userId <= 0) return;
      busy = true;
      try {
        const choice = await dialog.showMessageBox({ type: 'warning', title: 'Enable browser access on this Mac?',
          message: 'Allow the Rhythm web host to use your signed-in account?',
          detail: `This saves your existing account credential in a protected host-only file at ${credentialPath}. Anyone with access to the web host can use this account. No credential is sent to the browser. Restart the web host after enabling or renewing access.`,
          buttons: ['Enable browser access', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true });
        const latest = current();
        if (choice.response !== 0 || !latest || latest.sessionToken !== session.sessionToken || latest.productionApiBase !== session.productionApiBase || latest.userId !== session.userId) return;
        const directory = protectedDestination(credentialPath);
        const temp = path.join(directory, `.credential-${randomUUID()}.tmp`);
        let fd;
        try {
          fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
          fs.fchmodSync(fd, 0o600);
          fs.writeFileSync(fd, JSON.stringify({ productionApiBase: session.productionApiBase, userId: session.userId, sessionToken: session.sessionToken }));
          fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
          protectedDestination(credentialPath);
          fs.renameSync(temp, credentialPath);
        } finally {
          if (fd !== undefined) fs.closeSync(fd);
          fs.rmSync(temp, { force: true });
        }
      } catch {
        await dialog.showMessageBox({ type: 'error', title: 'Browser access not enabled', message: 'The host credential could not be saved safely. Check the destination ownership and permissions, then try again.' });
      } finally { busy = false; }
    },
  });
  // Preserve the existing native menu. When Electron has not created its default
  // menu yet, use its standard role menus rather than replacing desktop actions.
  const menu = Menu.getApplicationMenu() ?? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'fileMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]);
  const submenu = Menu.buildFromTemplate([]);
  submenu.append(item);
  const browserMenu = new MenuItem({ label: 'Browser access', submenu });
  browserMenu.submenu?.on?.('menu-will-show', () => { item.enabled = !busy && Boolean(current()); });
  menu.append(browserMenu);
  Menu.setApplicationMenu(menu);
}

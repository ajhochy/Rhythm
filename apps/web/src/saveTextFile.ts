// Electron denies downloads and popups, so exports go through the native save dialog there;
// a plain browser gets a normal download.
export async function saveTextFile(name: string, text: string, type: string): Promise<boolean> {
  const saveFile = window.rhythmShell?.saveFile;
  if (saveFile) return (await saveFile(name, text)) !== null;
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return true;
}

export function researchExportName(projectName: string, runId: string, format: 'html' | 'markdown'): string {
  const slug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'research';
  return `${slug}-${runId.slice(0, 8)}.${format === 'html' ? 'html' : 'md'}`;
}

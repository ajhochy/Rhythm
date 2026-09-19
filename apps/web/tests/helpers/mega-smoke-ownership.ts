/** Identify disposable rows owned by this smoke invocation. */
export function ownsMegaSmokeRow(row: Record<string, unknown>, marker: string): boolean {
  return ['name', 'title', 'label'].some((field) => {
    const value = row[field];
    return typeof value === 'string' && (value === marker || value.startsWith(`${marker}-`));
  });
}

export type OrganizedToolCatalog = 'skills' | 'mcp' | 'profiles' | 'models';

export type CatalogSortDirection = 'asc' | 'desc';
export type CatalogGroupMode = 'category' | 'none';

export interface CatalogRecord {
  id: string;
  [field: string]: unknown;
}

export interface CatalogSection<T extends CatalogRecord> {
  title: string;
  items: T[];
}

const CATALOG_TOOLS = new Set<OrganizedToolCatalog>([
  'skills',
  'mcp',
  'profiles',
  'models',
]);

export function isOrganizedToolCatalog(
  tool: string,
): tool is OrganizedToolCatalog {
  return CATALOG_TOOLS.has(tool as OrganizedToolCatalog);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function titleFor(tool: OrganizedToolCatalog, item: CatalogRecord): string {
  const candidates =
    tool === 'profiles'
      ? [item.label, item.name, item.id]
      : [item.name, item.title, item.label, item.id];
  return text(candidates.find((candidate) => text(candidate))) || item.id;
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, 'en', {
    numeric: true,
    sensitivity: 'base',
  });
}

function compareRecords(
  tool: OrganizedToolCatalog,
  left: CatalogRecord,
  right: CatalogRecord,
): number {
  return (
    compareText(titleFor(tool, left), titleFor(tool, right)) ||
    compareText(left.id, right.id)
  );
}

export function sortToolCatalogRecords<T extends CatalogRecord>(
  tool: OrganizedToolCatalog,
  items: readonly T[],
  direction: CatalogSortDirection = 'asc',
): T[] {
  const multiplier = direction === 'asc' ? 1 : -1;
  return [...items].sort(
    (left, right) => multiplier * compareRecords(tool, left, right),
  );
}

function modelSearchText(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value
    .flatMap((model) =>
      model && typeof model === 'object'
        ? [
            text((model as CatalogRecord).id),
            text((model as CatalogRecord).name),
          ]
        : [],
    )
    .join(' ');
}

function matchesSearch(item: CatalogRecord, query: string): boolean {
  if (!query) return true;
  return [
    item.id,
    item.name,
    item.title,
    item.label,
    item.description,
    item.source,
    item.status,
    item.providerID,
    item.providerId,
    modelSearchText(item.models),
  ]
    .map(text)
    .some((value) => value.toLocaleLowerCase().includes(query));
}

function categoryFor(
  tool: OrganizedToolCatalog,
  item: CatalogRecord,
): string {
  switch (tool) {
    case 'skills': {
      if (item.managed === true) return 'Managed skills';
      const source = text(item.source);
      return source ? `${source} skills` : 'Other skills';
    }
    case 'mcp': {
      const status = text(item.status).toLocaleLowerCase();
      if (status === 'connected') return 'Connected servers';
      if (status === 'disabled') return 'Disabled servers';
      return status ? 'Servers needing attention' : 'Other servers';
    }
    case 'profiles':
      return item.isManager === true ? 'Manager profiles' : 'Agent profiles';
    case 'models':
      return item.connected === true
        ? 'Connected providers'
        : 'Enabled providers';
  }
}

export function organizeToolCatalog<T extends CatalogRecord>(options: {
  tool: OrganizedToolCatalog;
  items: readonly T[];
  query?: string;
  groupMode?: CatalogGroupMode;
  sortDirection?: CatalogSortDirection;
}): CatalogSection<T>[] {
  const query = options.query?.trim().toLocaleLowerCase() ?? '';
  const sorted = sortToolCatalogRecords(
    options.tool,
    options.items.filter((item) => matchesSearch(item, query)),
    options.sortDirection,
  );
  if ((options.groupMode ?? 'category') === 'none') {
    return [{ title: 'All', items: sorted }];
  }

  const sections = new Map<string, T[]>();
  for (const item of sorted) {
    const category = categoryFor(options.tool, item);
    sections.set(category, [...(sections.get(category) ?? []), item]);
  }
  return [...sections.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([title, items]) => ({ title, items }));
}

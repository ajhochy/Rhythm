import type { PairedMacClient } from '@/lib/transport/paired-mac-client';

export interface MobileGatewayProject {
  id: string;
  name: string;
  icon: string | null;
}

function safeProject(value: unknown): MobileGatewayProject | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== 'string' ||
    !record.id.trim() ||
    typeof record.name !== 'string' ||
    !record.name.trim() ||
    (record.icon !== null && typeof record.icon !== 'string')
  ) {
    return null;
  }
  return {
    id: record.id,
    name: record.name,
    icon: typeof record.icon === 'string' ? record.icon : null,
  };
}

export async function listMobileGatewayProjects(
  client: PairedMacClient,
): Promise<MobileGatewayProject[]> {
  const response = await client.request<{ projects?: unknown }>(
    '/mobile-gateway/projects',
    { method: 'GET' },
  );
  const projects = Array.isArray(response?.projects)
    ? response.projects
        .map(safeProject)
        .filter((project): project is MobileGatewayProject => project !== null)
    : [];
  return [...new Map(projects.map((project) => [project.id, project])).values()];
}

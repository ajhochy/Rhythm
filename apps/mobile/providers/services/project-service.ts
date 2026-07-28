import type { OpencodeClient } from '@opencode-ai/sdk/v2/client';

function requireData<T>(data: T | undefined, operation: string): T {
  if (data === undefined) {
    throw new Error(`OpenCode ${operation} returned no data.`);
  }
  return data;
}

export type ProjectMetadataUpdate = {
  name?: string;
  icon?: {
    url?: string;
    override?: string;
    color?: string;
  };
  commands?: {
    start?: string;
  };
};

export async function updateProjectMetadata(
  client: OpencodeClient,
  projectId: string,
  update: ProjectMetadataUpdate,
) {
  return requireData(
    (await client.project.update({ projectID: projectId, ...update })).data,
    'project update request',
  );
}

export async function initializeProjectGit(client: OpencodeClient) {
  return requireData((await client.project.initGit()).data, 'Git initialization request');
}

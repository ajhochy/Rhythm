export type LiveArtifactVisibility = 'private' | 'shared' | 'organization';

export interface LiveArtifact {
  id: string; type: 'html'; title: string; ownerUserId: number; workspaceId: number;
  visibility: LiveArtifactVisibility; currentBundleRevision: number; currentBundleHash: string;
  currentStateRevision: number; currentStateHash: string; declaredCapabilities: string[];
  createdAt: string; updatedAt: string; updatedByUserId: number; deletedAt: string | null;
}

export interface LiveArtifactBundle { html: string; css: string; js: string; }

export interface Project {
  id: string;
  name: string;
  cwd: string;
  icon: string | null;
  vcsRoot: string | null;
  vcsBranch: string | null;
  vcsDirty: boolean;
  vcsCheckedAt: string | null;
  createdAt: string;
  archivedAt: string | null;
  /** Null for every legacy/generic catalog project. */
  coordinatorOwnerUserId?: number | null;
  /** Exact authenticated setup command, scoped by coordinatorOwnerUserId. */
  coordinatorSetupKey?: string | null;
  /** Only the server-created fresh-workspace provenance is trusted by C2. */
  coordinatorSetupProvenance?: 'c2_fresh_owned_workspace_v1' | null;
  coordinatorWorkspaceGeneration?: number | null;
  /** The server-selected eligible profile bound at fresh setup. */
  coordinatorProfileId?: string | null;
}

export interface CreateProjectDto {
  name: string;
  cwd: string;
  icon?: string | null;
}

export interface UpdateProjectDto {
  name?: string;
  cwd?: string;
  icon?: string | null;
  archivedAt?: string | null;
}

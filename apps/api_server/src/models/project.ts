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

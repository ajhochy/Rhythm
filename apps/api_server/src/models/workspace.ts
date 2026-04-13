export interface Workspace {
  id: number;
  name: string;
  joinCode: string;
  createdBy: number | null;
  createdAt: string;
}

export interface WorkspaceWithRole extends Workspace {
  role: 'admin' | 'staff';
}

export interface WorkspaceMember {
  userId: number;
  name: string;
  email: string;
  photoUrl: string | null;
  role: 'admin' | 'staff';
  joinedAt: string;
}

export interface CreateWorkspaceDto {
  name: string;
  createdBy: number;
}

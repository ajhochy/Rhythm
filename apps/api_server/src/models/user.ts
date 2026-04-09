export interface User {
  id: number;
  name: string;
  email: string;
  googleSub: string | null;
  photoUrl: string | null;
  role: string;
  isFacilitiesManager: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserDto {
  name: string;
  email: string;
  googleSub?: string | null;
  photoUrl?: string | null;
  role?: string;
  isFacilitiesManager?: boolean;
}

export interface UpdateUserDto {
  name?: string;
  email?: string;
  googleSub?: string | null;
  photoUrl?: string | null;
  role?: string;
  isFacilitiesManager?: boolean;
}

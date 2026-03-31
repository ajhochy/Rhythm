export interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserDto {
  name: string;
  email: string;
  role?: string;
}

export interface UpdateUserDto {
  name?: string;
  email?: string;
  role?: string;
}

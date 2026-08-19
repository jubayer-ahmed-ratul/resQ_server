// ─── Request Payloads ─────────────────────────────────────────────────────────

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  // No role field — only CITIZEN can self-register.
  // ADMIN/COORDINATOR/OPERATOR accounts are created by ADMIN via /api/users.
}

export interface LoginInput {
  email: string;
  password: string;
}

/**
 * Profile update — any authenticated user can update their own name/email/password.
 * Role changes are NOT allowed here — only ADMIN can change roles via /api/users.
 */
export interface UpdateProfileInput {
  name?: string;
  email?: string;
  password?: string;
}

// ─── Response Shapes ──────────────────────────────────────────────────────────

export type UserRole = 'ADMIN' | 'COORDINATOR' | 'OPERATOR' | 'CITIZEN';
export type UserStatus = 'ACTIVE' | 'INACTIVE';

/**
 * Safe user object — never includes the password field.
 */
export interface SafeUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface LoginResponse {
  token: string;
  user: SafeUser;
}
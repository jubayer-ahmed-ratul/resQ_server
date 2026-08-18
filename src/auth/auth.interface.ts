// ─── Request Payloads ─────────────────────────────────────────────────────────

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
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

export type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'ASSIGN'
  | 'REMOVE'
  | 'LOGIN'
  | 'LOGOUT'
  | 'DEACTIVATE'
  | 'ACTIVATE'
  | 'APPROVE'
  | 'REJECT'
  | 'CANCEL'
  | 'COMPLETE'
  | 'OTHER';

export interface AuditLogInput {
  actorId: string;
  action: AuditAction;
  entity: string;
  entityId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuditLogFilters {
  actorId?: string;
  entity?: string;
  entityId?: string;
  /** Internal: restrict results to one of these entity types (used for COORDINATOR scoping) */
  entityFilter?: string[];
}
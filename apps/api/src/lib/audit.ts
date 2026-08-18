/**
 * Audit log (M11) — append-only. Dipanggil dari route/service dengan db ATAU tx.
 * Jangan pernah log password hash / token.
 */
import { auditLogs } from '../db/schema';
import type { DbOrTx } from '../db';

export interface AuditEntry {
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function writeAudit(dbOrTx: DbOrTx, entry: AuditEntry): Promise<void> {
  await dbOrTx.insert(auditLogs).values({
    userId: entry.userId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    oldValues: entry.oldValues ?? null,
    newValues: entry.newValues ?? null,
    ipAddress: entry.ipAddress ?? null,
    userAgent: entry.userAgent ?? null,
  });
}

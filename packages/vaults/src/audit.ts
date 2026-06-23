import type { PiiField } from '@tomo/core';

/**
 * One Vault B field-release audit entry. Records WHO asked for WHICH field WHEN,
 * never the value. Data minimization: the released value is never part of the
 * audit record. (§3.3 / prime directive.)
 */
export interface AuditEntry {
  readonly user: string;
  readonly field: PiiField;
  /** ISO-8601 timestamp of the release. */
  readonly at: string;
  /** Free-text requester context (e.g. "executor:checkout"). Never a secret. */
  readonly requester: string;
}

/**
 * Append-only per-field access log. Every Vault B release appends exactly one
 * entry. The log is read-only to callers (returns immutable copies).
 */
export class AuditLog {
  private readonly entries: AuditEntry[] = [];

  /** Append a release record. Returns the appended (frozen) entry. */
  record(user: string, field: PiiField, requester: string, at: string): AuditEntry {
    const entry: AuditEntry = Object.freeze({ user, field, at, requester });
    this.entries.push(entry);
    return entry;
  }

  /** All entries (immutable copy), most-recent last. */
  all(): readonly AuditEntry[] {
    return [...this.entries];
  }

  /** Entries for a single user (immutable copy). */
  forUser(user: string): readonly AuditEntry[] {
    return this.entries.filter((e) => e.user === user);
  }

  /** Count of releases recorded for a user (optionally a specific field). */
  count(user: string, field?: PiiField): number {
    return this.entries.filter((e) => e.user === user && (field === undefined || e.field === field))
      .length;
  }
}

import crypto from 'crypto';
import { getDbMode, getMysqlDb, getSqliteDb } from './db';
import type { ChatAttachmentInput } from './friendChatService';

const CHAT_ATTACHMENT_RESERVATION_TTL_MS = Math.max(
  60_000,
  Number(process.env.CHAT_ATTACHMENT_RESERVATION_TTL_MS || 15 * 60_000)
);

type QuotaTotals = {
  active_bytes: number | string | bigint | null;
  reserved_bytes: number | string | bigint | null;
};

type ProcessedAttachmentInput = Omit<ChatAttachmentInput, 'attachmentId' | 'reused'>;

export type CommittedChatAttachment = {
  attachment: ChatAttachmentInput;
  discardProcessedFile: boolean;
  previousUrlToDelete: string | null;
};

export class ChatAttachmentLimitExceededError extends Error {
  readonly code = 'ChatAttachmentLimitExceeded';

  constructor() {
    super('ChatAttachmentLimitExceeded');
    this.name = 'ChatAttachmentLimitExceededError';
  }
}

export class ChatAttachmentQuotaReservationExpiredError extends Error {
  readonly code = 'ChatAttachmentQuotaReservationExpired';
  readonly retryAfterSeconds = 2;

  constructor() {
    super('ChatAttachmentQuotaReservationExpired');
    this.name = 'ChatAttachmentQuotaReservationExpiredError';
  }
}

const assertRequestedBytes = (requestedBytes: number, maxBytes: number) => {
  if (!Number.isSafeInteger(requestedBytes) || requestedBytes <= 0 || requestedBytes > maxBytes) {
    throw new ChatAttachmentLimitExceededError();
  }
};

const getSqlQuotaTotals = async (tx: any, userId: string, excludedReservationId?: string): Promise<QuotaTotals> => {
  const reservationFilter = excludedReservationId ? 'AND id <> ?' : '';
  const params = excludedReservationId
    ? [userId, userId, userId, excludedReservationId]
    : [userId, userId, userId];
  const row = await tx.get(`
    SELECT
      COALESCE((SELECT SUM(size_bytes)
                  FROM chat_attachments
                 WHERE owner_user_id = ?
                   AND deleted_at IS NULL
                   AND expires_at > CURRENT_TIMESTAMP), 0)
      + COALESCE((SELECT SUM(attachment_size_bytes)
                    FROM chat_messages
                   WHERE sender_id = ?
                     AND attachment_id IS NULL
                     AND message_type = 'image'
                     AND attachment_url IS NOT NULL
                     AND attachment_deleted_at IS NULL
                     AND (attachment_expires_at IS NULL OR attachment_expires_at > CURRENT_TIMESTAMP)), 0)
        AS active_bytes,
      COALESCE((SELECT SUM(reserved_bytes)
                  FROM chat_attachment_quota_reservations
                 WHERE user_id = ?
                   ${reservationFilter}), 0) AS reserved_bytes
  `, ...params) as QuotaTotals | undefined;
  return row || { active_bytes: 0, reserved_bytes: 0 };
};

const lockSqlQuota = async (tx: any, userId: string): Promise<void> => {
  await tx.run('INSERT IGNORE INTO chat_attachment_quota_locks (user_id) VALUES (?)', userId);
  const lock = await tx.get(
    'SELECT user_id FROM chat_attachment_quota_locks WHERE user_id = ? FOR UPDATE',
    userId
  );
  if (!lock) throw new Error('ChatAttachmentQuotaLockUnavailable');
  await tx.run(
    'DELETE FROM chat_attachment_quota_reservations WHERE user_id = ? AND expires_at <= CURRENT_TIMESTAMP',
    userId
  );
};

const reserveSqlQuota = async (
  userId: string,
  reservationId: string,
  requestedBytes: number,
  maxBytes: number,
  expiresAt: Date
): Promise<void> => {
  await getMysqlDb().transaction(async (tx) => {
    await lockSqlQuota(tx, userId);
    const totals = await getSqlQuotaTotals(tx, userId);
    if (Number(totals.active_bytes || 0) + Number(totals.reserved_bytes || 0) + requestedBytes > maxBytes) {
      throw new ChatAttachmentLimitExceededError();
    }
    await tx.run(
      `INSERT INTO chat_attachment_quota_reservations
        (id, user_id, reserved_bytes, expires_at)
       VALUES (?, ?, ?, ?)`,
      reservationId,
      userId,
      requestedBytes,
      expiresAt
    );
  });
};

const resizeSqlQuota = async (
  userId: string,
  reservationId: string,
  requestedBytes: number,
  maxBytes: number,
  expiresAt: Date
): Promise<void> => {
  await getMysqlDb().transaction(async (tx) => {
    await lockSqlQuota(tx, userId);
    const reservation = await tx.get(
      'SELECT id FROM chat_attachment_quota_reservations WHERE id = ? AND user_id = ? FOR UPDATE',
      reservationId,
      userId
    );
    if (!reservation) throw new ChatAttachmentQuotaReservationExpiredError();
    const totals = await getSqlQuotaTotals(tx, userId, reservationId);
    if (Number(totals.active_bytes || 0) + Number(totals.reserved_bytes || 0) + requestedBytes > maxBytes) {
      throw new ChatAttachmentLimitExceededError();
    }
    await tx.run(
      `UPDATE chat_attachment_quota_reservations
          SET reserved_bytes = ?, expires_at = ?
        WHERE id = ? AND user_id = ?`,
      requestedBytes,
      expiresAt,
      reservationId,
      userId
    );
  });
};

const getSqliteActiveBytes = (userId: string): number => {
  const row = getSqliteDb().prepare(`
    SELECT
      COALESCE((SELECT SUM(size_bytes)
                  FROM chat_attachments
                 WHERE owner_user_id = ?
                   AND deleted_at IS NULL
                   AND datetime(expires_at) > datetime('now')), 0)
      + COALESCE((SELECT SUM(attachment_size_bytes)
                    FROM chat_messages
                   WHERE sender_id = ?
                     AND attachment_id IS NULL
                     AND message_type = 'image'
                     AND attachment_url IS NOT NULL
                     AND attachment_deleted_at IS NULL
                     AND (attachment_expires_at IS NULL OR datetime(attachment_expires_at) > datetime('now'))), 0)
        AS active_bytes
  `).get(userId, userId) as { active_bytes?: number } | undefined;
  return Number(row?.active_bytes || 0);
};

const getSqliteReservedBytes = (userId: string, excludedReservationId?: string): number => {
  const row = excludedReservationId
    ? getSqliteDb().prepare(`
        SELECT COALESCE(SUM(reserved_bytes), 0) AS reserved_bytes
          FROM chat_attachment_quota_reservations
         WHERE user_id = ? AND id <> ?
      `).get(userId, excludedReservationId) as { reserved_bytes?: number }
    : getSqliteDb().prepare(`
        SELECT COALESCE(SUM(reserved_bytes), 0) AS reserved_bytes
          FROM chat_attachment_quota_reservations
         WHERE user_id = ?
      `).get(userId) as { reserved_bytes?: number };
  return Number(row?.reserved_bytes || 0);
};

const cleanupSqliteReservations = (userId: string) => {
  getSqliteDb().prepare(`
    DELETE FROM chat_attachment_quota_reservations
     WHERE user_id = ? AND datetime(expires_at) <= datetime('now')
  `).run(userId);
};

const mapCommittedAttachment = (
  row: any,
  fallbackExpiresAt: Date,
  reused: boolean
): ChatAttachmentInput => ({
  attachmentId: Number(row.id),
  url: String(row.url),
  mime: String(row.mime),
  sizeBytes: Number(row.size_bytes),
  width: row.width == null ? null : Number(row.width),
  height: row.height == null ? null : Number(row.height),
  expiresAt: fallbackExpiresAt,
  reused
});

const commitSqlQuotaReservation = async (
  userId: string,
  reservationId: string,
  sourceHash: string,
  attachment: ProcessedAttachmentInput,
  maxBytes: number
): Promise<CommittedChatAttachment> => getMysqlDb().transaction(async (tx) => {
  await lockSqlQuota(tx, userId);
  const reservation = await tx.get(
    'SELECT id FROM chat_attachment_quota_reservations WHERE id = ? AND user_id = ? FOR UPDATE',
    reservationId,
    userId
  );
  if (!reservation) throw new ChatAttachmentQuotaReservationExpiredError();

  const activeExisting = await tx.get(`
    SELECT id, url, mime, size_bytes, width, height, expires_at
      FROM chat_attachments
     WHERE owner_user_id = ?
       AND source_hash = ?
       AND deleted_at IS NULL
       AND expires_at > CURRENT_TIMESTAMP
     LIMIT 1
     FOR UPDATE
  `, userId, sourceHash) as any;
  if (activeExisting) {
    await tx.run(
      'UPDATE chat_attachments SET last_used_at = CURRENT_TIMESTAMP, expires_at = ? WHERE id = ?',
      attachment.expiresAt,
      activeExisting.id
    );
    await tx.run('DELETE FROM chat_attachment_quota_reservations WHERE id = ? AND user_id = ?', reservationId, userId);
    return {
      attachment: mapCommittedAttachment(activeExisting, attachment.expiresAt, true),
      discardProcessedFile: true,
      previousUrlToDelete: null
    };
  }

  const totals = await getSqlQuotaTotals(tx, userId, reservationId);
  if (Number(totals.active_bytes || 0) + Number(totals.reserved_bytes || 0) + attachment.sizeBytes > maxBytes) {
    throw new ChatAttachmentLimitExceededError();
  }

  const previous = await tx.get(
    'SELECT id, url FROM chat_attachments WHERE owner_user_id = ? AND source_hash = ? LIMIT 1 FOR UPDATE',
    userId,
    sourceHash
  ) as any;
  await tx.run(`
    INSERT INTO chat_attachments
      (owner_user_id, source_hash, url, mime, size_bytes, width, height, last_used_at, expires_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, NULL)
    ON DUPLICATE KEY UPDATE
      url = VALUES(url),
      mime = VALUES(mime),
      size_bytes = VALUES(size_bytes),
      width = VALUES(width),
      height = VALUES(height),
      last_used_at = CURRENT_TIMESTAMP,
      expires_at = VALUES(expires_at),
      deleted_at = NULL
  `,
  userId,
  sourceHash,
  attachment.url,
  attachment.mime,
  attachment.sizeBytes,
  attachment.width ?? null,
  attachment.height ?? null,
  attachment.expiresAt);
  const row = await tx.get(`
    SELECT id, url, mime, size_bytes, width, height, expires_at
      FROM chat_attachments
     WHERE owner_user_id = ? AND source_hash = ?
     LIMIT 1
  `, userId, sourceHash) as any;
  if (!row) throw new Error('ChatAttachmentCommitFailed');
  await tx.run('DELETE FROM chat_attachment_quota_reservations WHERE id = ? AND user_id = ?', reservationId, userId);
  return {
    attachment: mapCommittedAttachment(row, attachment.expiresAt, false),
    discardProcessedFile: false,
    previousUrlToDelete: previous?.url && previous.url !== attachment.url ? String(previous.url) : null
  };
});

const commitSqliteQuotaReservation = (
  userId: string,
  reservationId: string,
  sourceHash: string,
  attachment: ProcessedAttachmentInput,
  maxBytes: number
): CommittedChatAttachment => {
  const db = getSqliteDb();
  return db.transaction(() => {
    cleanupSqliteReservations(userId);
    const reservation = db.prepare(`
      SELECT id FROM chat_attachment_quota_reservations WHERE id = ? AND user_id = ?
    `).get(reservationId, userId);
    if (!reservation) throw new ChatAttachmentQuotaReservationExpiredError();

    const activeExisting = db.prepare(`
      SELECT id, url, mime, size_bytes, width, height, expires_at
        FROM chat_attachments
       WHERE owner_user_id = ?
         AND source_hash = ?
         AND deleted_at IS NULL
         AND datetime(expires_at) > datetime('now')
       LIMIT 1
    `).get(userId, sourceHash) as any;
    if (activeExisting) {
      db.prepare("UPDATE chat_attachments SET last_used_at = datetime('now'), expires_at = ? WHERE id = ?")
        .run(attachment.expiresAt.toISOString(), activeExisting.id);
      db.prepare('DELETE FROM chat_attachment_quota_reservations WHERE id = ? AND user_id = ?').run(reservationId, userId);
      return {
        attachment: mapCommittedAttachment(activeExisting, attachment.expiresAt, true),
        discardProcessedFile: true,
        previousUrlToDelete: null
      };
    }

    if (getSqliteActiveBytes(userId) + getSqliteReservedBytes(userId, reservationId) + attachment.sizeBytes > maxBytes) {
      throw new ChatAttachmentLimitExceededError();
    }
    const previous = db.prepare(
      'SELECT id, url FROM chat_attachments WHERE owner_user_id = ? AND source_hash = ? LIMIT 1'
    ).get(userId, sourceHash) as any;
    db.prepare(`
      INSERT INTO chat_attachments
        (owner_user_id, source_hash, url, mime, size_bytes, width, height, last_used_at, expires_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, NULL)
      ON CONFLICT(owner_user_id, source_hash) DO UPDATE SET
        url = excluded.url,
        mime = excluded.mime,
        size_bytes = excluded.size_bytes,
        width = excluded.width,
        height = excluded.height,
        last_used_at = datetime('now'),
        expires_at = excluded.expires_at,
        deleted_at = NULL
    `).run(
      userId,
      sourceHash,
      attachment.url,
      attachment.mime,
      attachment.sizeBytes,
      attachment.width ?? null,
      attachment.height ?? null,
      attachment.expiresAt.toISOString()
    );
    const row = db.prepare(`
      SELECT id, url, mime, size_bytes, width, height, expires_at
        FROM chat_attachments
       WHERE owner_user_id = ? AND source_hash = ?
       LIMIT 1
    `).get(userId, sourceHash) as any;
    if (!row) throw new Error('ChatAttachmentCommitFailed');
    db.prepare('DELETE FROM chat_attachment_quota_reservations WHERE id = ? AND user_id = ?').run(reservationId, userId);
    return {
      attachment: mapCommittedAttachment(row, attachment.expiresAt, false),
      discardProcessedFile: false,
      previousUrlToDelete: previous?.url && previous.url !== attachment.url ? String(previous.url) : null
    };
  })();
};

export const reserveChatAttachmentQuota = async (
  userId: string,
  requestedBytes: number,
  maxBytes: number
): Promise<string> => {
  assertRequestedBytes(requestedBytes, maxBytes);
  const reservationId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + CHAT_ATTACHMENT_RESERVATION_TTL_MS);
  const mode = getDbMode();

  if (mode === 'MYSQL') {
    await reserveSqlQuota(userId, reservationId, requestedBytes, maxBytes, expiresAt);
    return reservationId;
  }
  if (mode === 'LOCAL_SQL') {
    const db = getSqliteDb();
    db.transaction(() => {
      db.prepare('INSERT OR IGNORE INTO chat_attachment_quota_locks (user_id) VALUES (?)').run(userId);
      cleanupSqliteReservations(userId);
      if (getSqliteActiveBytes(userId) + getSqliteReservedBytes(userId) + requestedBytes > maxBytes) {
        throw new ChatAttachmentLimitExceededError();
      }
      db.prepare(`
        INSERT INTO chat_attachment_quota_reservations (id, user_id, reserved_bytes, expires_at)
        VALUES (?, ?, ?, ?)
      `).run(reservationId, userId, requestedBytes, expiresAt.toISOString());
    })();
    return reservationId;
  }
  throw new Error('ChatAttachmentQuotaStorageUnsupported');
};

export const resizeChatAttachmentQuotaReservation = async (
  userId: string,
  reservationId: string,
  requestedBytes: number,
  maxBytes: number
): Promise<void> => {
  assertRequestedBytes(requestedBytes, maxBytes);
  const expiresAt = new Date(Date.now() + CHAT_ATTACHMENT_RESERVATION_TTL_MS);
  const mode = getDbMode();
  if (mode === 'MYSQL') {
    await resizeSqlQuota(userId, reservationId, requestedBytes, maxBytes, expiresAt);
    return;
  }
  if (mode === 'LOCAL_SQL') {
    const db = getSqliteDb();
    db.transaction(() => {
      cleanupSqliteReservations(userId);
      const reservation = db.prepare(`
        SELECT id FROM chat_attachment_quota_reservations WHERE id = ? AND user_id = ?
      `).get(reservationId, userId);
      if (!reservation) throw new ChatAttachmentQuotaReservationExpiredError();
      if (getSqliteActiveBytes(userId) + getSqliteReservedBytes(userId, reservationId) + requestedBytes > maxBytes) {
        throw new ChatAttachmentLimitExceededError();
      }
      db.prepare(`
        UPDATE chat_attachment_quota_reservations
           SET reserved_bytes = ?, expires_at = ?
         WHERE id = ? AND user_id = ?
      `).run(requestedBytes, expiresAt.toISOString(), reservationId, userId);
    })();
    return;
  }
  throw new Error('ChatAttachmentQuotaStorageUnsupported');
};

export const commitChatAttachmentQuotaReservation = async (
  userId: string,
  reservationId: string,
  sourceHash: string,
  attachment: ProcessedAttachmentInput,
  maxBytes: number
): Promise<CommittedChatAttachment> => {
  assertRequestedBytes(attachment.sizeBytes, maxBytes);
  const mode = getDbMode();
  if (mode === 'MYSQL') {
    return commitSqlQuotaReservation(userId, reservationId, sourceHash, attachment, maxBytes);
  }
  if (mode === 'LOCAL_SQL') {
    return commitSqliteQuotaReservation(userId, reservationId, sourceHash, attachment, maxBytes);
  }
  throw new Error('ChatAttachmentQuotaStorageUnsupported');
};

export const releaseChatAttachmentQuotaReservation = async (
  userId: string,
  reservationId: string
): Promise<void> => {
  const mode = getDbMode();
  if (mode === 'MYSQL') {
    await getMysqlDb().run(
      'DELETE FROM chat_attachment_quota_reservations WHERE id = ? AND user_id = ?',
      reservationId,
      userId
    );
    return;
  }
  if (mode === 'LOCAL_SQL') {
    getSqliteDb().prepare(
      'DELETE FROM chat_attachment_quota_reservations WHERE id = ? AND user_id = ?'
    ).run(reservationId, userId);
    return;
  }
  throw new Error('ChatAttachmentQuotaStorageUnsupported');
};

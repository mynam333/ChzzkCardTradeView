import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __setSqliteDbForTest } from '../services/db';
import {
  commitChatAttachmentQuotaReservation,
  releaseChatAttachmentQuotaReservation,
  reserveChatAttachmentQuota,
  resizeChatAttachmentQuotaReservation
} from '../services/chatAttachmentQuotaService';
import { deleteSavedChatAttachment } from '../services/friendChatService';

describe('chatAttachmentQuotaService', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY);
      CREATE TABLE chat_attachments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_user_id TEXT NOT NULL,
        source_hash TEXT NOT NULL,
        url TEXT NOT NULL,
        mime TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        width INTEGER,
        height INTEGER,
        last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT NOT NULL,
        deleted_at TEXT,
        UNIQUE(owner_user_id, source_hash)
      );
      CREATE TABLE chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id TEXT NOT NULL,
        attachment_id INTEGER,
        message_type TEXT NOT NULL,
        attachment_url TEXT,
        attachment_size_bytes INTEGER,
        attachment_expires_at TEXT,
        attachment_deleted_at TEXT
      );
      CREATE TABLE chat_attachment_quota_locks (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE chat_attachment_quota_reservations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reserved_bytes INTEGER NOT NULL CHECK (reserved_bytes > 0),
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    db.prepare('INSERT INTO users (id) VALUES (?)').run('user-1');
    __setSqliteDbForTest(db);
  });

  afterEach(() => {
    __setSqliteDbForTest(null);
    db.close();
  });

  it('serializes simultaneous reservations so only one can consume the remaining capacity', async () => {
    const results = await Promise.allSettled([
      reserveChatAttachmentQuota('user-1', 60, 100),
      reserveChatAttachmentQuota('user-1', 60, 100)
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(db.prepare('SELECT SUM(reserved_bytes) AS total FROM chat_attachment_quota_reservations').get())
      .toEqual({ total: 60 });
  });

  it('counts persisted active attachments and outstanding reservations together', async () => {
    db.prepare(`
      INSERT INTO chat_attachments (owner_user_id, source_hash, url, mime, size_bytes, expires_at, deleted_at)
      VALUES (?, 'existing-1', '/existing-1.webp', 'image/webp', ?, datetime('now', '+1 day'), NULL)
    `).run('user-1', 60);

    const reservationId = await reserveChatAttachmentQuota('user-1', 30, 100);
    await expect(reserveChatAttachmentQuota('user-1', 11, 100)).rejects.toThrow('ChatAttachmentLimitExceeded');

    await releaseChatAttachmentQuotaReservation('user-1', reservationId);
    await expect(reserveChatAttachmentQuota('user-1', 40, 100)).resolves.toBeTypeOf('string');
  });

  it('rechecks the quota when processed output grows beyond the initial upload reservation', async () => {
    db.prepare(`
      INSERT INTO chat_attachments (owner_user_id, source_hash, url, mime, size_bytes, expires_at, deleted_at)
      VALUES (?, 'existing-2', '/existing-2.webp', 'image/webp', ?, datetime('now', '+1 day'), NULL)
    `).run('user-1', 60);
    const reservationId = await reserveChatAttachmentQuota('user-1', 20, 100);

    await expect(
      resizeChatAttachmentQuotaReservation('user-1', reservationId, 41, 100)
    ).rejects.toThrow('ChatAttachmentLimitExceeded');

    expect(db.prepare('SELECT reserved_bytes FROM chat_attachment_quota_reservations WHERE id = ?').get(reservationId))
      .toEqual({ reserved_bytes: 20 });
  });

  it('cleans abandoned reservations and cascades live reservations on account deletion', async () => {
    const expiredId = await reserveChatAttachmentQuota('user-1', 80, 100);
    db.prepare("UPDATE chat_attachment_quota_reservations SET expires_at = datetime('now', '-1 minute') WHERE id = ?")
      .run(expiredId);

    await expect(reserveChatAttachmentQuota('user-1', 100, 100)).resolves.toBeTypeOf('string');
    db.prepare('DELETE FROM users WHERE id = ?').run('user-1');

    expect(db.prepare('SELECT COUNT(*) AS count FROM chat_attachment_quota_reservations').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM chat_attachment_quota_locks').get()).toEqual({ count: 0 });
  });

  it('atomically converts a reservation into a persisted attachment', async () => {
    const reservationId = await reserveChatAttachmentQuota('user-1', 20, 100);
    const processed = {
      url: '/new.webp',
      mime: 'image/webp',
      sizeBytes: 18,
      width: 10,
      height: 10,
      expiresAt: new Date(Date.now() + 60_000)
    };

    const committed = await commitChatAttachmentQuotaReservation(
      'user-1',
      reservationId,
      'same-source',
      processed,
      100
    );

    expect(committed.attachment).toMatchObject({ url: '/new.webp', sizeBytes: 18, reused: false });
    expect(committed.discardProcessedFile).toBe(false);
    expect(db.prepare('SELECT COUNT(*) AS count FROM chat_attachment_quota_reservations').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT url, size_bytes FROM chat_attachments WHERE source_hash = ?').get('same-source'))
      .toEqual({ url: '/new.webp', size_bytes: 18 });
  });

  it('does not let a concurrent same-hash commit replace the first request file', async () => {
    const firstReservation = await reserveChatAttachmentQuota('user-1', 20, 100);
    const secondReservation = await reserveChatAttachmentQuota('user-1', 20, 100);
    const first = {
      url: '/first.webp',
      mime: 'image/webp',
      sizeBytes: 20,
      expiresAt: new Date(Date.now() + 60_000)
    };
    const second = { ...first, url: '/second.webp' };

    await commitChatAttachmentQuotaReservation('user-1', firstReservation, 'same-source', first, 100);
    const raced = await commitChatAttachmentQuotaReservation('user-1', secondReservation, 'same-source', second, 100);

    expect(raced.discardProcessedFile).toBe(true);
    expect(raced.attachment).toMatchObject({ url: '/first.webp', reused: true });
    expect(db.prepare('SELECT url FROM chat_attachments WHERE source_hash = ?').get('same-source'))
      .toEqual({ url: '/first.webp' });
    expect(db.prepare('SELECT COUNT(*) AS count FROM chat_attachment_quota_reservations').get()).toEqual({ count: 0 });
  });

  it('does not delete a persisted attachment after another request has referenced it', async () => {
    const reservationId = await reserveChatAttachmentQuota('user-1', 20, 100);
    const committed = await commitChatAttachmentQuotaReservation('user-1', reservationId, 'referenced-source', {
      url: '/referenced.webp',
      mime: 'image/webp',
      sizeBytes: 20,
      expiresAt: new Date(Date.now() + 60_000)
    }, 100);
    db.prepare(`
      INSERT INTO chat_messages
        (sender_id, attachment_id, message_type, attachment_url, attachment_size_bytes, attachment_expires_at)
      VALUES (?, ?, 'image', ?, ?, ?)
    `).run(
      'user-1',
      committed.attachment.attachmentId,
      committed.attachment.url,
      committed.attachment.sizeBytes,
      committed.attachment.expiresAt.toISOString()
    );

    await deleteSavedChatAttachment(committed.attachment);

    expect(db.prepare('SELECT deleted_at FROM chat_attachments WHERE id = ?').get(committed.attachment.attachmentId))
      .toEqual({ deleted_at: null });
  });
});

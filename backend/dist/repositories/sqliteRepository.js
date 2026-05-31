"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SqliteUserCardRepository = exports.SqliteAnnouncementRepository = exports.SqliteReportRepository = exports.SqliteCouponRepository = exports.SqliteStreamerRepository = exports.SqliteUserRepository = void 0;
const db_1 = require("../services/db");
// 1. SQLite 유저 레포지토리
class SqliteUserRepository {
    getDb() {
        return (0, db_1.getSqliteDb)();
    }
    async findById(id) {
        const row = this.getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
        if (!row)
            return null;
        return {
            id: row.id,
            username: row.username,
            avatar_url: row.avatar_url,
            role: row.role,
            point: row.point,
            last_free_draw: row.last_free_draw,
            banned_until: row.banned_until,
            access_token: row.access_token,
            refresh_token: row.refresh_token,
            created_at: row.created_at
        };
    }
    async create(user) {
        this.getDb().prepare('INSERT INTO users (id, username, avatar_url, role, point, access_token, refresh_token) VALUES (?, ?, ?, ?, ?, ?, ?)').run(user.id, user.username, user.avatar_url, user.role, user.point, user.access_token || null, user.refresh_token || null);
        return user;
    }
    async updatePoint(id, point) {
        this.getDb().prepare('UPDATE users SET point = ? WHERE id = ?').run(point, id);
    }
    async updateBanStatus(id, bannedUntil) {
        this.getDb().prepare('UPDATE users SET banned_until = ? WHERE id = ?').run(bannedUntil, id);
    }
    async updateLastFreeDraw(id, time) {
        this.getDb().prepare('UPDATE users SET last_free_draw = ? WHERE id = ?').run(time, id);
    }
    async updateProfile(id, username, avatarUrl, accessToken, refreshToken) {
        if (accessToken !== undefined && refreshToken !== undefined) {
            this.getDb().prepare('UPDATE users SET username = ?, avatar_url = ?, access_token = ?, refresh_token = ? WHERE id = ?').run(username, avatarUrl, accessToken, refreshToken, id);
        }
        else if (accessToken !== undefined) {
            this.getDb().prepare('UPDATE users SET username = ?, avatar_url = ?, access_token = ? WHERE id = ?').run(username, avatarUrl, accessToken, id);
        }
        else {
            this.getDb().prepare('UPDATE users SET username = ?, avatar_url = ? WHERE id = ?').run(username, avatarUrl, id);
        }
    }
    async findRankings(limit) {
        const rows = this.getDb().prepare('SELECT * FROM users ORDER BY point DESC LIMIT ?').all(limit);
        return rows.map((row) => ({
            id: row.id,
            username: row.username,
            avatar_url: row.avatar_url,
            role: row.role,
            point: row.point,
            last_free_draw: row.last_free_draw,
            banned_until: row.banned_until,
            created_at: row.created_at
        }));
    }
}
exports.SqliteUserRepository = SqliteUserRepository;
// 2. SQLite 스트리머 레포지토리
class SqliteStreamerRepository {
    getDb() {
        return (0, db_1.getSqliteDb)();
    }
    async findAll() {
        const rows = this.getDb().prepare('SELECT * FROM streamers ORDER BY base_value DESC').all();
        return rows.map((row) => ({
            channel_id: row.channel_id,
            name: row.name,
            logo_url: row.logo_url,
            custom_image_url: row.custom_image_url,
            is_image_banned: row.is_image_banned === 1,
            follower_count: row.follower_count,
            activity_score: row.activity_score,
            base_value: row.base_value,
            is_active: row.is_active === 1,
            serial_number: row.serial_number || undefined,
            updated_at: row.updated_at
        }));
    }
    async findById(channelId) {
        const row = this.getDb().prepare('SELECT * FROM streamers WHERE channel_id = ?').get(channelId);
        if (!row)
            return null;
        return {
            channel_id: row.channel_id,
            name: row.name,
            logo_url: row.logo_url,
            custom_image_url: row.custom_image_url,
            is_image_banned: row.is_image_banned === 1,
            follower_count: row.follower_count,
            activity_score: row.activity_score,
            base_value: row.base_value,
            is_active: row.is_active === 1,
            serial_number: row.serial_number || undefined,
            updated_at: row.updated_at
        };
    }
    async save(streamer) {
        this.getDb().prepare(`
      INSERT INTO streamers (channel_id, name, logo_url, follower_count, activity_score, base_value, is_active, serial_number)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(channel_id) DO UPDATE SET
        name = excluded.name,
        logo_url = excluded.logo_url,
        follower_count = excluded.follower_count,
        activity_score = excluded.activity_score,
        base_value = excluded.base_value,
        is_active = excluded.is_active,
        serial_number = COALESCE(excluded.serial_number, streamers.serial_number),
        updated_at = datetime('now')
    `).run(streamer.channel_id, streamer.name, streamer.logo_url, streamer.follower_count, streamer.activity_score, streamer.base_value, streamer.is_active ? 1 : 0, streamer.serial_number || null);
    }
    async updateCustomImage(channelId, imageUrl) {
        this.getDb().prepare('UPDATE streamers SET custom_image_url = ?, updated_at = datetime(\'now\') WHERE channel_id = ?')
            .run(imageUrl, channelId);
    }
    async updateImageBanStatus(channelId, isBanned) {
        this.getDb().prepare('UPDATE streamers SET is_image_banned = ?, updated_at = datetime(\'now\') WHERE channel_id = ?')
            .run(isBanned ? 1 : 0, channelId);
    }
    async findStreamerIndex(channelId) {
        const rows = this.getDb().prepare('SELECT channel_id FROM streamers ORDER BY channel_id').all();
        const index = rows.findIndex(r => r.channel_id === channelId);
        return index !== -1 ? index + 1 : 1;
    }
    async findMaxSerialNumber() {
        const row = this.getDb().prepare('SELECT MAX(serial_number) as max_sn FROM streamers').get();
        return row && row.max_sn ? row.max_sn : 0;
    }
    async findAllocatedStreamerSerialNumbers() {
        const rows = this.getDb().prepare('SELECT serial_number FROM streamers WHERE serial_number IS NOT NULL ORDER BY serial_number ASC').all();
        return rows.map(r => r.serial_number);
    }
    async updateLiveStatus(channelId, isActive, followerCount) {
        this.getDb().prepare('UPDATE streamers SET is_active = ?, follower_count = ?, updated_at = datetime(\'now\') WHERE channel_id = ?')
            .run(isActive ? 1 : 0, followerCount, channelId);
    }
}
exports.SqliteStreamerRepository = SqliteStreamerRepository;
// 3. SQLite 쿠폰 레포지토리
class SqliteCouponRepository {
    getDb() {
        return (0, db_1.getSqliteDb)();
    }
    async findByCode(code) {
        const row = this.getDb().prepare('SELECT * FROM coupons WHERE code = ?').get(code);
        if (!row)
            return null;
        return {
            id: row.id,
            code: row.code,
            coupon_type: row.coupon_type,
            points: row.points,
            max_uses: row.max_uses,
            used_count: row.used_count,
            expires_at: row.expires_at,
            created_at: row.created_at
        };
    }
    async create(coupon) {
        const result = this.getDb().prepare('INSERT INTO coupons (code, coupon_type, points, max_uses, used_count, expires_at) VALUES (?, ?, ?, ?, ?, ?)').run(coupon.code, coupon.coupon_type, coupon.points, coupon.max_uses, coupon.used_count, coupon.expires_at);
        coupon.id = Number(result.lastInsertRowid);
        return coupon;
    }
    async incrementUsedCount(couponId) {
        this.getDb().prepare('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?').run(couponId);
    }
    async checkCouponRedeemed(couponId, userId) {
        const row = this.getDb().prepare('SELECT 1 FROM coupon_logs WHERE coupon_id = ? AND user_id = ?').get(couponId, userId);
        return !!row;
    }
    async logCouponRedeem(couponId, userId) {
        this.getDb().prepare('INSERT INTO coupon_logs (coupon_id, user_id) VALUES (?, ?)').run(couponId, userId);
    }
}
exports.SqliteCouponRepository = SqliteCouponRepository;
// 4. SQLite 신고 레포지토리
class SqliteReportRepository {
    getDb() {
        return (0, db_1.getSqliteDb)();
    }
    async findAll() {
        const rows = this.getDb().prepare('SELECT * FROM card_reports ORDER BY id DESC').all();
        return rows.map((row) => ({
            id: row.id,
            reporter_id: row.reporter_id,
            channel_id: row.channel_id,
            reported_image_url: row.reported_image_url,
            reason: row.reason,
            status: row.status,
            created_at: row.created_at
        }));
    }
    async create(report) {
        const result = this.getDb().prepare('INSERT INTO card_reports (reporter_id, channel_id, reported_image_url, reason, status) VALUES (?, ?, ?, ?, ?)').run(report.reporter_id, report.channel_id, report.reported_image_url, report.reason, report.status);
        report.id = Number(result.lastInsertRowid);
        return report;
    }
    async updateStatus(reportId, status) {
        this.getDb().prepare('UPDATE card_reports SET status = ? WHERE id = ?').run(status, reportId);
    }
}
exports.SqliteReportRepository = SqliteReportRepository;
// 5. SQLite 공지사항 레포지토리
class SqliteAnnouncementRepository {
    getDb() {
        return (0, db_1.getSqliteDb)();
    }
    async findAll() {
        const rows = this.getDb().prepare('SELECT * FROM announcements ORDER BY id DESC').all();
        return rows.map((row) => ({
            id: row.id,
            title: row.title,
            content: row.content,
            is_popup: row.is_popup === 1,
            popup_expires_at: row.popup_expires_at,
            created_at: row.created_at
        }));
    }
    async findActivePopups() {
        // 현재 시각 기준으로 유효한 팝업만 추출
        const rows = this.getDb().prepare(`
      SELECT * FROM announcements 
      WHERE is_popup = 1 
        AND (popup_expires_at IS NULL OR datetime(popup_expires_at) > datetime('now')) 
      ORDER BY id DESC
    `).all();
        return rows.map((row) => ({
            id: row.id,
            title: row.title,
            content: row.content,
            is_popup: true,
            popup_expires_at: row.popup_expires_at,
            created_at: row.created_at
        }));
    }
    async create(announcement) {
        const result = this.getDb().prepare('INSERT INTO announcements (title, content, is_popup, popup_expires_at) VALUES (?, ?, ?, ?)').run(announcement.title, announcement.content, announcement.is_popup ? 1 : 0, announcement.popup_expires_at);
        announcement.id = Number(result.lastInsertRowid);
        return announcement;
    }
    async delete(id) {
        this.getDb().prepare('DELETE FROM announcements WHERE id = ?').run(id);
    }
}
exports.SqliteAnnouncementRepository = SqliteAnnouncementRepository;
// 6. SQLite 유저 보유 카드 레포지토리
class SqliteUserCardRepository {
    getDb() {
        return (0, db_1.getSqliteDb)();
    }
    async create(card) {
        const result = this.getDb().prepare('INSERT INTO user_cards (user_id, channel_id, serial_number) VALUES (?, ?, ?)').run(card.user_id, card.channel_id, card.serial_number);
        card.id = Number(result.lastInsertRowid);
        return card;
    }
    async findByUserId(userId) {
        const rows = this.getDb().prepare(`
      SELECT uc.*, s.name as streamer_name, s.logo_url as streamer_logo, s.custom_image_url as streamer_custom_image, 
             s.base_value as streamer_base_value, s.follower_count as streamer_follower, 
             s.is_active as streamer_is_active, s.is_image_banned as streamer_is_image_banned
      FROM user_cards uc
      JOIN streamers s ON uc.channel_id = s.channel_id
      WHERE uc.user_id = ?
      ORDER BY uc.id DESC
    `).all(userId);
        return rows.map((row) => ({
            id: row.id,
            user_id: row.user_id,
            channel_id: row.channel_id,
            serial_number: row.serial_number,
            acquired_at: row.acquired_at,
            streamer: {
                channel_id: row.channel_id,
                name: row.streamer_name,
                logo_url: row.streamer_logo,
                custom_image_url: row.streamer_custom_image,
                base_value: row.streamer_base_value,
                follower_count: row.streamer_follower,
                is_image_banned: row.streamer_is_image_banned === 1,
                activity_score: 0,
                is_active: row.streamer_is_active === 1
            }
        }));
    }
    async findLatestSerialNumber(channelId) {
        const row = this.getDb().prepare('SELECT MAX(serial_number) as max_sn FROM user_cards WHERE channel_id = ?').get(channelId);
        return row && row.max_sn ? row.max_sn : 0;
    }
    async findAllocatedSerialNumbers(channelId) {
        const rows = this.getDb().prepare('SELECT serial_number FROM user_cards WHERE channel_id = ? ORDER BY serial_number ASC').all(channelId);
        return rows.map(r => r.serial_number);
    }
    async deleteCards(userId, channelId, count) {
        // 특정 개수만큼만 삭제하기 위해 rowid 또는 id를 조회해서 IN 절로 삭제합니다.
        const rows = this.getDb().prepare('SELECT id FROM user_cards WHERE user_id = ? AND channel_id = ? ORDER BY id ASC LIMIT ?').all(userId, channelId, count);
        if (rows.length === 0)
            return 0;
        const ids = rows.map(r => r.id);
        const placeholders = ids.map(() => '?').join(',');
        const result = this.getDb().prepare(`DELETE FROM user_cards WHERE id IN (${placeholders})`).run(...ids);
        return result.changes;
    }
}
exports.SqliteUserCardRepository = SqliteUserCardRepository;

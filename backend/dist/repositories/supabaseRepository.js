"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SupabaseUserCardRepository = exports.SupabaseAnnouncementRepository = exports.SupabaseReportRepository = exports.SupabaseCouponRepository = exports.SupabaseStreamerRepository = exports.SupabaseUserRepository = void 0;
const db_1 = require("../services/db");
// 1. Supabase 유저 레포지토리
class SupabaseUserRepository {
    getClient() {
        return (0, db_1.getSupabaseClient)();
    }
    async findById(id) {
        const { data, error } = await this.getClient()
            .from('users')
            .select('*')
            .eq('id', id)
            .single();
        if (error || !data)
            return null;
        return data;
    }
    async create(user) {
        const { data, error } = await this.getClient()
            .from('users')
            .insert([user])
            .select()
            .single();
        if (error)
            throw error;
        return data;
    }
    async updatePoint(id, point) {
        const { error } = await this.getClient()
            .from('users')
            .update({ point })
            .eq('id', id);
        if (error)
            throw error;
    }
    async updateBanStatus(id, bannedUntil) {
        const { error } = await this.getClient()
            .from('users')
            .update({ banned_until: bannedUntil })
            .eq('id', id);
        if (error)
            throw error;
    }
    async updateLastFreeDraw(id, time) {
        const { error } = await this.getClient()
            .from('users')
            .update({ last_free_draw: time })
            .eq('id', id);
        if (error)
            throw error;
    }
    async updateProfile(id, username, avatarUrl, accessToken, refreshToken) {
        const updatePayload = { username, avatar_url: avatarUrl };
        if (accessToken !== undefined)
            updatePayload.access_token = accessToken;
        if (refreshToken !== undefined)
            updatePayload.refresh_token = refreshToken;
        const { error } = await this.getClient()
            .from('users')
            .update(updatePayload)
            .eq('id', id);
        if (error)
            throw error;
    }
    async findRankings(limit) {
        const { data, error } = await this.getClient()
            .from('users')
            .select('*')
            .order('point', { ascending: false })
            .limit(limit);
        if (error)
            throw error;
        return (data || []);
    }
}
exports.SupabaseUserRepository = SupabaseUserRepository;
// 2. Supabase 스트리머 레포지토리
class SupabaseStreamerRepository {
    getClient() {
        return (0, db_1.getSupabaseClient)();
    }
    async findAll() {
        const { data, error } = await this.getClient()
            .from('streamers')
            .select('*')
            .order('base_value', { ascending: false });
        if (error)
            throw error;
        return (data || []);
    }
    async findById(channelId) {
        const { data, error } = await this.getClient()
            .from('streamers')
            .select('*')
            .eq('channel_id', channelId)
            .single();
        if (error || !data)
            return null;
        return data;
    }
    async save(streamer) {
        const { error } = await this.getClient()
            .from('streamers')
            .upsert(streamer);
        if (error)
            throw error;
    }
    async updateCustomImage(channelId, imageUrl) {
        const { error } = await this.getClient()
            .from('streamers')
            .update({ custom_image_url: imageUrl, updated_at: new Date().toISOString() })
            .eq('channel_id', channelId);
        if (error)
            throw error;
    }
    async updateImageBanStatus(channelId, isBanned) {
        const { error } = await this.getClient()
            .from('streamers')
            .update({ is_image_banned: isBanned, updated_at: new Date().toISOString() })
            .eq('channel_id', channelId);
        if (error)
            throw error;
    }
    async findStreamerIndex(channelId) {
        const { data, error } = await this.getClient()
            .from('streamers')
            .select('channel_id')
            .order('channel_id', { ascending: true });
        if (error || !data)
            return 1;
        const index = data.findIndex(r => r.channel_id === channelId);
        return index !== -1 ? index + 1 : 1;
    }
    async findMaxSerialNumber() {
        const { data, error } = await this.getClient()
            .from('streamers')
            .select('serial_number')
            .order('serial_number', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error || !data)
            return 0;
        return data.serial_number || 0;
    }
    async findAllocatedStreamerSerialNumbers() {
        const { data, error } = await this.getClient()
            .from('streamers')
            .select('serial_number')
            .not('serial_number', 'is', null)
            .order('serial_number', { ascending: true });
        if (error || !data)
            return [];
        return data.map(r => r.serial_number);
    }
    async updateLiveStatus(channelId, isActive, followerCount) {
        const { error } = await this.getClient()
            .from('streamers')
            .update({
            is_active: isActive,
            follower_count: followerCount,
            updated_at: new Date().toISOString()
        })
            .eq('channel_id', channelId);
        if (error)
            throw error;
    }
}
exports.SupabaseStreamerRepository = SupabaseStreamerRepository;
// 3. Supabase 쿠폰 레포지토리
class SupabaseCouponRepository {
    getClient() {
        return (0, db_1.getSupabaseClient)();
    }
    async findByCode(code) {
        const { data, error } = await this.getClient()
            .from('coupons')
            .select('*')
            .eq('code', code)
            .single();
        if (error || !data)
            return null;
        return data;
    }
    async create(coupon) {
        const { data, error } = await this.getClient()
            .from('coupons')
            .insert([coupon])
            .select()
            .single();
        if (error)
            throw error;
        return data;
    }
    async incrementUsedCount(couponId) {
        const { data } = await this.getClient()
            .from('coupons')
            .select('used_count')
            .eq('id', couponId)
            .single();
        const nextCount = (data?.used_count || 0) + 1;
        const { error } = await this.getClient()
            .from('coupons')
            .update({ used_count: nextCount })
            .eq('id', couponId);
        if (error)
            throw error;
    }
    async checkCouponRedeemed(couponId, userId) {
        const { data, error } = await this.getClient()
            .from('coupon_logs')
            .select('id')
            .eq('coupon_id', couponId)
            .eq('user_id', userId)
            .maybeSingle();
        return !error && data !== null;
    }
    async logCouponRedeem(couponId, userId) {
        const { error } = await this.getClient()
            .from('coupon_logs')
            .insert([{ coupon_id: couponId, user_id: userId }]);
        if (error)
            throw error;
    }
}
exports.SupabaseCouponRepository = SupabaseCouponRepository;
// 4. Supabase 신고 레포지토리
class SupabaseReportRepository {
    getClient() {
        return (0, db_1.getSupabaseClient)();
    }
    async findAll() {
        const { data, error } = await this.getClient()
            .from('card_reports')
            .select('*')
            .order('id', { ascending: false });
        if (error)
            throw error;
        return (data || []);
    }
    async create(report) {
        const { data, error } = await this.getClient()
            .from('card_reports')
            .insert([report])
            .select()
            .single();
        if (error)
            throw error;
        return data;
    }
    async updateStatus(reportId, status) {
        const { error } = await this.getClient()
            .from('card_reports')
            .update({ status })
            .eq('id', reportId);
        if (error)
            throw error;
    }
}
exports.SupabaseReportRepository = SupabaseReportRepository;
// 5. Supabase 공지사항 레포지토리
class SupabaseAnnouncementRepository {
    getClient() {
        return (0, db_1.getSupabaseClient)();
    }
    async findAll() {
        const { data, error } = await this.getClient()
            .from('announcements')
            .select('*')
            .order('id', { ascending: false });
        if (error)
            throw error;
        return (data || []);
    }
    async findActivePopups() {
        const now = new Date().toISOString();
        const { data, error } = await this.getClient()
            .from('announcements')
            .select('*')
            .eq('is_popup', true)
            .or(`popup_expires_at.is.null,popup_expires_at.gt.${now}`)
            .order('id', { ascending: false });
        if (error)
            throw error;
        return (data || []);
    }
    async create(announcement) {
        const { data, error } = await this.getClient()
            .from('announcements')
            .insert([announcement])
            .select()
            .single();
        if (error)
            throw error;
        return data;
    }
    async delete(id) {
        const { error } = await this.getClient()
            .from('announcements')
            .delete()
            .eq('id', id);
        if (error)
            throw error;
    }
}
exports.SupabaseAnnouncementRepository = SupabaseAnnouncementRepository;
// 6. Supabase 유저 보유 카드 레포지토리
class SupabaseUserCardRepository {
    getClient() {
        return (0, db_1.getSupabaseClient)();
    }
    async create(card) {
        const { data, error } = await this.getClient()
            .from('user_cards')
            .insert([card])
            .select()
            .single();
        if (error)
            throw error;
        return data;
    }
    async findByUserId(userId) {
        // Supabase 상에서 user_cards와 streamers를 Inner Join
        const { data, error } = await this.getClient()
            .from('user_cards')
            .select(`
        id,
        user_id,
        channel_id,
        serial_number,
        acquired_at,
        streamer:streamers (
          channel_id,
          name,
          logo_url,
          custom_image_url,
          base_value,
          follower_count,
          is_active,
          is_image_banned
        )
      `)
            .eq('user_id', userId)
            .order('id', { ascending: false });
        if (error)
            throw error;
        return (data || []);
    }
    async findLatestSerialNumber(channelId) {
        const { data, error } = await this.getClient()
            .from('user_cards')
            .select('serial_number')
            .eq('channel_id', channelId)
            .order('serial_number', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error) {
            console.error('[SupabaseUserCardRepository] findLatestSerialNumber 에러:', error);
            return 0;
        }
        return data ? data.serial_number : 0;
    }
    async findAllocatedSerialNumbers(channelId) {
        const { data, error } = await this.getClient()
            .from('user_cards')
            .select('serial_number')
            .eq('channel_id', channelId)
            .order('serial_number', { ascending: true });
        if (error) {
            console.error('[SupabaseUserCardRepository] findAllocatedSerialNumbers 에러:', error);
            return [];
        }
        return (data || []).map(r => r.serial_number);
    }
    async deleteCards(userId, channelId, count) {
        // 특정 개수만큼만 삭제하기 위해 row를 먼저 조회 후 id로 매칭하여 삭제합니다.
        const { data: rows, error: selectError } = await this.getClient()
            .from('user_cards')
            .select('id')
            .eq('user_id', userId)
            .eq('channel_id', channelId)
            .order('id', { ascending: true })
            .limit(count);
        if (selectError || !rows || rows.length === 0)
            return 0;
        const ids = rows.map(r => r.id);
        const { error: deleteError, count: deletedCount } = await this.getClient()
            .from('user_cards')
            .delete({ count: 'exact' })
            .in('id', ids);
        if (deleteError)
            throw deleteError;
        return deletedCount || ids.length;
    }
}
exports.SupabaseUserCardRepository = SupabaseUserCardRepository;

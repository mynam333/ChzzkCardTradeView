"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SupabaseAnnouncementRepository = exports.SupabaseReportRepository = exports.SupabaseCouponRepository = exports.SupabaseStreamerRepository = exports.SupabaseUserRepository = void 0;
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

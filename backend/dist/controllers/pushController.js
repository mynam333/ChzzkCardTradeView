"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startPushNotificationSchedulerHandler = exports.startPushNotificationScheduler = exports.scheduleNotification = exports.subscribePush = exports.getVapidPublicKey = exports.initVapid = void 0;
const web_push_1 = __importDefault(require("web-push"));
const node_cron_1 = __importDefault(require("node-cron"));
const db_1 = require("../services/db");
// VAPID 키는 dotenv.config() 이후에 읽어야 하므로 지연 초기화(Lazy Initialization) 사용
const getVapidKeys = () => ({
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
});
/**
 * VAPID 초기화 함수 - app.ts에서 dotenv.config() 직후 호출해야 합니다.
 */
const initVapid = () => {
    const { publicKey, privateKey } = getVapidKeys();
    if (publicKey && privateKey) {
        web_push_1.default.setVapidDetails('mailto:admin@chzzkcardtrade.com', publicKey, privateKey);
        console.log('[Push] 웹 푸시 VAPID 설정이 성공적으로 로드되었습니다.');
    }
    else {
        console.warn('[Push] VAPID 키가 누락되었습니다. 푸시 알림 기능이 작동하지 않을 수 있습니다.');
    }
};
exports.initVapid = initVapid;
/**
 * 1. 푸시 알림 VAPID Public Key 조회 API
 */
const getVapidPublicKey = (req, res) => {
    return res.status(200).json({ publicKey: getVapidKeys().publicKey });
};
exports.getVapidPublicKey = getVapidPublicKey;
/**
 * 2. 브라우저 푸시 알림 구독 정보 등록 API
 */
const subscribePush = async (req, res) => {
    const userId = req.user?.id;
    const { subscription } = req.body; // { endpoint, keys: { auth, p256dh } }
    if (!userId || !subscription || !subscription.endpoint) {
        return res.status(400).json({ error: 'BadRequest', message: '올바른 구독 정보 및 인증이 필요합니다.' });
    }
    const endpoint = subscription.endpoint;
    const authKey = subscription.keys?.auth || '';
    const p256dhKey = subscription.keys?.p256dh || '';
    try {
        const dbMode = (0, db_1.getDbMode)();
        if (dbMode === 'SUPABASE') {
            const client = (0, db_1.getSupabaseClient)();
            // 기존 구독 정보가 있으면 갱신, 없으면 삽입 (upsert)
            const { error } = await client
                .from('push_subscriptions')
                .upsert({
                user_id: userId,
                endpoint,
                auth_key: authKey,
                p256dh_key: p256dhKey
            }, { onConflict: 'user_id,endpoint' });
            if (error)
                throw error;
        }
        else {
            const db = (0, db_1.getSqliteDb)();
            // SQLite: 중복 시 UPDATE 처리
            db.prepare(`
        INSERT INTO push_subscriptions (user_id, endpoint, auth_key, p256dh_key)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, endpoint) DO UPDATE SET
          auth_key = excluded.auth_key,
          p256dh_key = excluded.p256dh_key,
          created_at = datetime('now')
      `).run(userId, endpoint, authKey, p256dhKey);
        }
        return res.status(201).json({ message: '푸시 알림 구독 등록이 완료되었습니다.' });
    }
    catch (err) {
        return res.status(500).json({ error: 'InternalServerError', message: '구독 등록 실패', details: err.message });
    }
};
exports.subscribePush = subscribePush;
/**
 * 3. 예약 푸시 알림 등록 API (ADMIN 전용)
 */
const scheduleNotification = async (req, res) => {
    const { title, body, scheduled_at } = req.body;
    if (!title || !body) {
        return res.status(400).json({ error: 'BadRequest', message: '푸시 알림의 제목(title)과 본문(body)은 필수입니다.' });
    }
    try {
        const dbMode = (0, db_1.getDbMode)();
        let scheduledTime = null;
        if (scheduled_at) {
            scheduledTime = new Date(scheduled_at).toISOString();
        }
        if (dbMode === 'SUPABASE') {
            const client = (0, db_1.getSupabaseClient)();
            const { error } = await client
                .from('push_notifications')
                .insert([{
                    title,
                    body,
                    status: 'pending',
                    scheduled_at: scheduledTime
                }]);
            if (error)
                throw error;
        }
        else {
            const db = (0, db_1.getSqliteDb)();
            db.prepare(`
        INSERT INTO push_notifications (title, body, status, scheduled_at)
        VALUES (?, ?, 'pending', ?)
      `).run(title, body, scheduledTime);
        }
        return res.status(201).json({
            message: scheduledTime
                ? `${scheduledTime} 에 발송되도록 예약 설정되었습니다.`
                : '푸시 알림이 즉시 발송 대기 상태로 등록되었습니다.'
        });
    }
    catch (err) {
        return res.status(500).json({ error: 'InternalServerError', message: '푸시 예약 생성 실패', details: err.message });
    }
};
exports.scheduleNotification = scheduleNotification;
/**
 * 4. PWA 푸시 알림 실제 전송 유틸리티 함수
 */
const sendPushToAll = async (title, body) => {
    try {
        const dbMode = (0, db_1.getDbMode)();
        let subscriptions = [];
        if (dbMode === 'SUPABASE') {
            const client = (0, db_1.getSupabaseClient)();
            const { data, error } = await client.from('push_subscriptions').select('*');
            if (!error && data) {
                subscriptions = data;
            }
        }
        else {
            const db = (0, db_1.getSqliteDb)();
            subscriptions = db.prepare('SELECT * FROM push_subscriptions').all();
        }
        const payload = JSON.stringify({ title, body });
        const promises = subscriptions.map((sub) => {
            const pushSubscription = {
                endpoint: sub.endpoint,
                keys: {
                    auth: sub.auth_key,
                    p256dh: sub.p256dh_key
                }
            };
            return web_push_1.default.sendNotification(pushSubscription, payload).catch((err) => {
                // 만료되었거나 에러난 구독 정보 삭제 처리
                if (err.statusCode === 410 || err.statusCode === 404) {
                    console.log(`[Push] 만료된 구독 엔드포인트 정리: ${sub.endpoint}`);
                    if (dbMode === 'SUPABASE') {
                        (0, db_1.getSupabaseClient)().from('push_subscriptions').delete().eq('id', sub.id).then();
                    }
                    else {
                        (0, db_1.getSqliteDb)().prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
                    }
                }
            });
        });
        await Promise.all(promises);
        console.log(`[Push] 푸시 알림 전송 완료 (대상 기기: ${promises.length}대)`);
    }
    catch (err) {
        console.error('[Push] 푸시 알림 일괄 전송 도중 에러:', err);
    }
};
/**
 * node-cron 푸시 스케줄러 등록
 * 1분마다 주기적으로 감시하여 전송할 시간이 경과한 'pending' 푸시를 자동 일괄 발송합니다.
 */
const startPushNotificationScheduler = () => {
    // 1분 주기 감시
    node_cron_1.default.schedule('* * * * *', async () => {
        try {
            const dbMode = (0, db_1.getDbMode)();
            const nowIso = new Date().toISOString();
            let pendingNotifs = [];
            if (dbMode === 'SUPABASE') {
                const client = (0, db_1.getSupabaseClient)();
                const { data, error } = await client
                    .from('push_notifications')
                    .select('*')
                    .eq('status', 'pending')
                    .or(`scheduled_at.is.null,scheduled_at.lte.${nowIso}`);
                if (!error && data) {
                    pendingNotifs = data;
                }
            }
            else {
                const db = (0, db_1.getSqliteDb)();
                pendingNotifs = db.prepare(`
          SELECT * FROM push_notifications 
          WHERE status = 'pending' 
            AND (scheduled_at IS NULL OR datetime(scheduled_at) <= datetime(?))
        `).all(nowIso);
            }
            if (pendingNotifs.length === 0)
                return;
            console.log(`[Scheduler] ${pendingNotifs.length}건의 발송 대기 중인 푸시 알림을 감지했습니다.`);
            for (const notif of pendingNotifs) {
                // 즉시 전송 실행
                await sendPushToAll(notif.title, notif.body);
                // 상태를 'sent'로 업데이트
                if (dbMode === 'SUPABASE') {
                    await (0, db_1.getSupabaseClient)()
                        .from('push_notifications')
                        .update({ status: 'sent' })
                        .eq('id', notif.id);
                }
                else {
                    (0, db_1.getSqliteDb)().prepare('UPDATE push_notifications SET status = \'sent\' WHERE id = ?').run(notif.id);
                }
            }
        }
        catch (err) {
            console.error('[Scheduler] 예약 푸시 알림 스케줄러 구동 중 오류:', err);
        }
    });
    console.log('[Scheduler] PWA 예약 푸시 스케줄러 감시 워커가 가동되었습니다. (1분 간격)');
};
exports.startPushNotificationScheduler = startPushNotificationScheduler;
exports.startPushNotificationSchedulerHandler = exports.startPushNotificationScheduler;

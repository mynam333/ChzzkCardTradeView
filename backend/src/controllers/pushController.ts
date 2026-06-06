import { Request, Response } from 'express';
import webpush from 'web-push';
import cron from 'node-cron';
import { getDbMode, getSqliteDb, getSupabaseClient } from '../services/db';
import { AuthenticatedRequest } from '../middlewares/admin';
import { IS_PRODUCTION } from '../config';
import { couponRepository } from '../repositories';
import { normalizeCouponCode } from '../utils/couponCode';
import { buildCouponPushUrl } from '../utils/pushTarget';

// VAPID 키는 dotenv.config() 이후에 읽어야 하므로 지연 초기화(Lazy Initialization) 사용
const getVapidKeys = () => ({
  publicKey: process.env.VAPID_PUBLIC_KEY || '',
  privateKey: process.env.VAPID_PRIVATE_KEY || '',
});

/**
 * VAPID 초기화 함수 - app.ts에서 dotenv.config() 직후 호출해야 합니다.
 */
export const initVapid = () => {
  const { publicKey, privateKey } = getVapidKeys();
  if (publicKey && privateKey) {
    webpush.setVapidDetails(
      'mailto:admin@chzzkcardtrade.com',
      publicKey,
      privateKey
    );
    console.log('[Push] 웹 푸시 VAPID 설정이 성공적으로 로드되었습니다.');
  } else {
    console.warn('[Push] VAPID 키가 누락되었습니다. 푸시 알림 기능이 작동하지 않을 수 있습니다.');
  }
};

/**
 * 1. 푸시 알림 VAPID Public Key 조회 API
 */
export const getVapidPublicKey = (req: Request, res: Response) => {
  return res.status(200).json({ publicKey: getVapidKeys().publicKey });
};

/**
 * 2. 브라우저 푸시 알림 구독 정보 등록 API
 */
export const subscribePush = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  const { subscription } = req.body; // { endpoint, keys: { auth, p256dh } }

  if (!userId || !subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'BadRequest', message: '올바른 구독 정보 및 인증이 필요합니다.' });
  }

  const endpoint = subscription.endpoint;
  const authKey = subscription.keys?.auth || '';
  const p256dhKey = subscription.keys?.p256dh || '';

  try {
    const dbMode = getDbMode();

    if (dbMode === 'SUPABASE') {
      const client = getSupabaseClient();
      // 기존 구독 정보가 있으면 갱신, 없으면 삽입 (upsert)
      const { error } = await client
        .from('push_subscriptions')
        .upsert({
          user_id: userId,
          endpoint,
          auth_key: authKey,
          p256dh_key: p256dhKey
        }, { onConflict: 'user_id,endpoint' });

      if (error) throw error;
    } else {
      const db = getSqliteDb();
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
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '구독 등록 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 3. 예약 푸시 알림 등록 API (ADMIN 전용)
 */
export const scheduleNotification = async (req: Request, res: Response) => {
  const { title, body, scheduled_at, coupon_code } = req.body;
  const couponCode = normalizeCouponCode(coupon_code);

  if (!title || !body) {
    return res.status(400).json({ error: 'BadRequest', message: '푸시 알림의 제목(title)과 본문(body)은 필수입니다.' });
  }
  if (coupon_code && !couponCode) {
    return res.status(400).json({ error: 'BadRequest', message: '올바른 쿠폰 코드를 선택해주세요.' });
  }

  try {
    if (couponCode && !(await couponRepository.findByCode(couponCode))) {
      return res.status(404).json({ error: 'NotFound', message: '푸시에 연결할 쿠폰을 찾을 수 없습니다.' });
    }

    const dbMode = getDbMode();
    let scheduledTime = null;
    if (scheduled_at) {
      scheduledTime = new Date(scheduled_at).toISOString();
    }

    if (dbMode === 'SUPABASE') {
      const client = getSupabaseClient();
      const { error } = await client
        .from('push_notifications')
        .insert([{
          title,
          body,
          coupon_code: couponCode || null,
          status: 'pending',
          scheduled_at: scheduledTime
        }]);

      if (error) throw error;
    } else {
      const db = getSqliteDb();
      db.prepare(`
        INSERT INTO push_notifications (title, body, coupon_code, status, scheduled_at)
        VALUES (?, ?, ?, 'pending', ?)
      `).run(title, body, couponCode || null, scheduledTime);
    }

    return res.status(201).json({
      message: scheduledTime
        ? `${scheduledTime} 에 발송되도록 예약 설정되었습니다.`
        : '푸시 알림이 즉시 발송 대기 상태로 등록되었습니다.'
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '푸시 예약 생성 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 4. PWA 푸시 알림 실제 전송 유틸리티 함수
 */
const sendPushToAll = async (title: string, body: string, url = '/') => {
  try {
    const dbMode = getDbMode();
    let subscriptions: any[] = [];

    if (dbMode === 'SUPABASE') {
      const client = getSupabaseClient();
      const { data, error } = await client.from('push_subscriptions').select('*');
      if (!error && data) {
        subscriptions = data;
      }
    } else {
      const db = getSqliteDb();
      subscriptions = db.prepare('SELECT * FROM push_subscriptions').all();
    }

    const payload = JSON.stringify({ title, body, url });
    const promises = subscriptions.map((sub) => {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          auth: sub.auth_key,
          p256dh: sub.p256dh_key
        }
      };

      return webpush.sendNotification(pushSubscription, payload).catch((err: any) => {
        // 만료되었거나 에러난 구독 정보 삭제 처리
        if (err.statusCode === 410 || err.statusCode === 404) {
          console.log(`[Push] 만료된 구독 엔드포인트 정리: ${sub.endpoint}`);
          if (dbMode === 'SUPABASE') {
            getSupabaseClient().from('push_subscriptions').delete().eq('id', sub.id).then();
          } else {
            getSqliteDb().prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
          }
        }
      });
    });

    await Promise.all(promises);
    console.log(`[Push] 푸시 알림 전송 완료 (대상 기기: ${promises.length}대)`);
  } catch (err) {
    console.error('[Push] 푸시 알림 일괄 전송 도중 에러:', err);
  }
};

/**
 * 특정 유저에게만 푸시 알림을 전송합니다 (교환 알림 등). 실패해도 호출부에 영향을 주지 않습니다.
 */
export const sendPushToUser = async (userId: string, title: string, body: string, url?: string) => {
  try {
    const dbMode = getDbMode();
    let subscriptions: any[] = [];

    if (dbMode === 'SUPABASE') {
      const { data, error } = await getSupabaseClient()
        .from('push_subscriptions').select('*').eq('user_id', userId);
      if (!error && data) subscriptions = data;
    } else {
      subscriptions = getSqliteDb().prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId);
    }

    if (subscriptions.length === 0) return;

    const payload = JSON.stringify({ title, body, url: url || '/' });
    await Promise.all(subscriptions.map((sub) => {
      const pushSubscription = { endpoint: sub.endpoint, keys: { auth: sub.auth_key, p256dh: sub.p256dh_key } };
      return webpush.sendNotification(pushSubscription, payload).catch((err: any) => {
        if (err.statusCode === 410 || err.statusCode === 404) {
          if (dbMode === 'SUPABASE') {
            getSupabaseClient().from('push_subscriptions').delete().eq('id', sub.id).then();
          } else {
            getSqliteDb().prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
          }
        }
      });
    }));
  } catch (err) {
    console.error('[Push] 개별 푸시 전송 중 에러:', err);
  }
};

/**
 * node-cron 푸시 스케줄러 등록
 * 1분마다 주기적으로 감시하여 전송할 시간이 경과한 'pending' 푸시를 자동 일괄 발송합니다.
 */
export const startPushNotificationScheduler = () => {
  // 1분 주기 감시
  cron.schedule('* * * * *', async () => {
    try {
      const dbMode = getDbMode();
      const nowIso = new Date().toISOString();
      let pendingNotifs: any[] = [];

      if (dbMode === 'SUPABASE') {
        const client = getSupabaseClient();
        const { data, error } = await client
          .from('push_notifications')
          .update({ status: 'sending' })
          .eq('status', 'pending')
          .or(`scheduled_at.is.null,scheduled_at.lte.${nowIso}`)
          .select('*');
        
        if (!error && data) {
          pendingNotifs = data;
        }
      } else {
        const db = getSqliteDb();
        pendingNotifs = db.transaction(() => {
          const rows = db.prepare(`
            SELECT * FROM push_notifications
            WHERE status = 'pending'
              AND (scheduled_at IS NULL OR datetime(scheduled_at) <= datetime(?))
          `).all(nowIso) as any[];
          if (rows.length === 0) return rows;

          const placeholders = rows.map(() => '?').join(',');
          db.prepare(`UPDATE push_notifications SET status = 'sending' WHERE id IN (${placeholders}) AND status = 'pending'`)
            .run(...rows.map((r) => r.id));
          return rows;
        })();
      }

      if (pendingNotifs.length === 0) return;

      console.log(`[Scheduler] ${pendingNotifs.length}건의 발송 대기 중인 푸시 알림을 감지했습니다.`);

      for (const notif of pendingNotifs) {
        // 즉시 전송 실행
        await sendPushToAll(notif.title, notif.body, buildCouponPushUrl(notif.coupon_code));

        // 상태를 'sent'로 업데이트
        if (dbMode === 'SUPABASE') {
          await getSupabaseClient()
            .from('push_notifications')
            .update({ status: 'sent' })
            .eq('id', notif.id);
        } else {
          getSqliteDb().prepare('UPDATE push_notifications SET status = \'sent\' WHERE id = ?').run(notif.id);
        }
      }
    } catch (err) {
      console.error('[Scheduler] 예약 푸시 알림 스케줄러 구동 중 오류:', err);
    }
  });

  console.log('[Scheduler] PWA 예약 푸시 스케줄러 감시 워커가 가동되었습니다. (1분 간격)');
};

/**
 * 5. 예약된 푸시 알림 목록 조회 API (ADMIN 전용)
 */
export const getScheduledNotifications = async (req: Request, res: Response) => {
  try {
    const dbMode = getDbMode();
    let list: any[] = [];
    if (dbMode === 'SUPABASE') {
      const client = getSupabaseClient();
      const { data, error } = await client
        .from('push_notifications')
        .select('*')
        .eq('status', 'pending')
        .order('scheduled_at', { ascending: true });
      if (error) throw error;
      list = data || [];
    } else {
      const db = getSqliteDb();
      list = db.prepare(`
        SELECT * FROM push_notifications 
        WHERE status = 'pending' 
        ORDER BY scheduled_at ASC
      `).all();
    }
    return res.status(200).json(list);
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '예약 목록 조회 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 6. 전송 완료된 푸시 알림 목록 조회 API (ADMIN 전용)
 */
export const getSentNotifications = async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const rawLimit = parseInt(String(req.query.limit || '10'), 10) || 10;
    const limit = Math.min(100, Math.max(1, rawLimit));
    const offset = (page - 1) * limit;

    const dbMode = getDbMode();
    let list: any[] = [];
    let total = 0;

    if (dbMode === 'SUPABASE') {
      const client = getSupabaseClient();
      
      // 전체 개수 조회
      const { count, error: countErr } = await client
        .from('push_notifications')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'sent');
        
      if (countErr) throw countErr;
      total = count || 0;

      // 페이징 데이터 조회
      const { data, error } = await client
        .from('push_notifications')
        .select('*')
        .eq('status', 'sent')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
        
      if (error) throw error;
      list = data || [];
    } else {
      const db = getSqliteDb();
      
      // 전체 개수 조회
      const countRes = db.prepare(`
        SELECT COUNT(*) as cnt FROM push_notifications 
        WHERE status = 'sent'
      `).get() as any;
      total = countRes ? countRes.cnt : 0;

      // 페이징 데이터 조회
      list = db.prepare(`
        SELECT * FROM push_notifications 
        WHERE status = 'sent' 
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `).all(limit, offset);
    }

    return res.status(200).json({
      notifications: list,
      total,
      page,
      limit,
      total_pages: Math.max(1, Math.ceil(total / limit))
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '전송 이력 조회 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 7. 예약 푸시 알림 수정 API (ADMIN 전용)
 */
export const updateScheduledNotification = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { title, body, scheduled_at, coupon_code } = req.body;
  const couponCode = normalizeCouponCode(coupon_code);

  if (!title || !body) {
    return res.status(400).json({ error: 'BadRequest', message: '제목(title)과 본문(body)은 필수입니다.' });
  }
  if (coupon_code && !couponCode) {
    return res.status(400).json({ error: 'BadRequest', message: '올바른 쿠폰 코드를 선택해주세요.' });
  }

  try {
    if (couponCode && !(await couponRepository.findByCode(couponCode))) {
      return res.status(404).json({ error: 'NotFound', message: '푸시에 연결할 쿠폰을 찾을 수 없습니다.' });
    }

    const dbMode = getDbMode();
    let scheduledTime = null;
    if (scheduled_at) {
      scheduledTime = new Date(scheduled_at).toISOString();
    }

    if (dbMode === 'SUPABASE') {
      const client = getSupabaseClient();
      // 기존 상태 체크
      const { data: existing, error: findErr } = await client
        .from('push_notifications')
        .select('status')
        .eq('id', id)
        .single();
      
      if (findErr || !existing) {
        return res.status(404).json({ error: 'NotFound', message: '수정할 푸시 알림을 찾을 수 없습니다.' });
      }

      if (existing.status !== 'pending') {
        return res.status(400).json({ error: 'BadRequest', message: '이미 전송된 푸시 알림은 수정할 수 없습니다.' });
      }

      const { error } = await client
        .from('push_notifications')
        .update({ title, body, coupon_code: couponCode || null, scheduled_at: scheduledTime })
        .eq('id', id);

      if (error) throw error;
    } else {
      const db = getSqliteDb();
      const existing = db.prepare('SELECT status FROM push_notifications WHERE id = ?').get(id) as any;
      if (!existing) {
        return res.status(404).json({ error: 'NotFound', message: '수정할 푸시 알림을 찾을 수 없습니다.' });
      }
      if (existing.status !== 'pending') {
        return res.status(400).json({ error: 'BadRequest', message: '이미 전송된 푸시 알림은 수정할 수 없습니다.' });
      }

      db.prepare(`
        UPDATE push_notifications 
        SET title = ?, body = ?, coupon_code = ?, scheduled_at = ?
        WHERE id = ?
      `).run(title, body, couponCode || null, scheduledTime, id);
    }

    return res.status(200).json({ message: '예약된 푸시 알림이 성공적으로 수정되었습니다.' });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '푸시 수정 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 8. 예약 푸시 알림 취소(삭제) API (ADMIN 전용)
 */
export const deleteScheduledNotification = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const dbMode = getDbMode();

    if (dbMode === 'SUPABASE') {
      const client = getSupabaseClient();
      const { data: existing, error: findErr } = await client
        .from('push_notifications')
        .select('status')
        .eq('id', id)
        .single();
      
      if (findErr || !existing) {
        return res.status(404).json({ error: 'NotFound', message: '취소할 푸시 알림을 찾을 수 없습니다.' });
      }

      if (existing.status !== 'pending') {
        return res.status(400).json({ error: 'BadRequest', message: '이미 전송 완료된 푸시 알림은 취소할 수 없습니다.' });
      }

      const { error } = await client
        .from('push_notifications')
        .delete()
        .eq('id', id);

      if (error) throw error;
    } else {
      const db = getSqliteDb();
      const existing = db.prepare('SELECT status FROM push_notifications WHERE id = ?').get(id) as any;
      if (!existing) {
        return res.status(404).json({ error: 'NotFound', message: '취소할 푸시 알림을 찾을 수 없습니다.' });
      }
      if (existing.status !== 'pending') {
        return res.status(400).json({ error: 'BadRequest', message: '이미 전송 완료된 푸시 알림은 취소할 수 없습니다.' });
      }

      db.prepare('DELETE FROM push_notifications WHERE id = ?').run(id);
    }

    return res.status(200).json({ message: '예약된 푸시 알림이 성공적으로 취소(삭제)되었습니다.' });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '푸시 취소 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

import WebSocket from 'ws';
import { streamerRepository } from '../repositories';

const CHAT_COUNT_FLUSH_INTERVAL_MS = Math.max(1000, Number(process.env.CHAT_COUNT_FLUSH_INTERVAL_MS || 5000));

// 웹소켓 메시지 전송용 인터페이스
interface ChzzkSocketFrame {
  ver: string;
  cmd: number;
  svcid?: string;
  cid?: string;
  sid?: string;
  bdy?: any;
  tid?: number;
}

class ChzzkChatManager {
  // 채널 ID별 WebSocket 연결 관리 맵 (재연결용 메타데이터 보관)
  private connections: Map<
    string,
    {
      socket: WebSocket;
      pingInterval?: NodeJS.Timeout;
      chatChannelId: string;
      streamerAccessToken?: string;
      isExplicitlyClosed?: boolean;
    }
  > = new Map();

  // 현재 "연결되어 있어야 하는" 채널 집합 (방송 중). 재연결 가드로 사용.
  private desired: Set<string> = new Set();
  // 채널별 대기 중인 재연결 타이머 (disconnect 시 취소용)
  private reconnectTimers: Map<string, NodeJS.Timeout> = new Map();
  private pendingChatCounts: Map<string, number> = new Map();
  private flushTimer?: NodeJS.Timeout;
  private isFlushing = false;

  constructor() {
    this.flushTimer = setInterval(() => {
      this.flushPendingChatCounts().catch((err: any) => {
        console.error('[ChatManager] 채팅 카운트 flush 실패:', err?.message || err);
      });
    }, CHAT_COUNT_FLUSH_INTERVAL_MS);
  }

  private addPendingChatCount(channelId: string, count: number) {
    if (count <= 0) return;
    this.pendingChatCounts.set(channelId, (this.pendingChatCounts.get(channelId) || 0) + count);
  }

  private drainPendingChatCounts(): Map<string, number> {
    const snapshot = this.pendingChatCounts;
    this.pendingChatCounts = new Map();
    return snapshot;
  }

  private restorePendingChatCounts(snapshot: Map<string, number>) {
    for (const [channelId, count] of snapshot) {
      this.pendingChatCounts.set(channelId, (this.pendingChatCounts.get(channelId) || 0) + count);
    }
  }

  private async flushPendingChatCounts() {
    if (this.isFlushing || this.pendingChatCounts.size === 0) return;
    this.isFlushing = true;
    const snapshot = this.drainPendingChatCounts();
    try {
      for (const [channelId, count] of snapshot) {
        await streamerRepository.incrementChatCount(channelId, count);
      }
    } catch (err) {
      this.restorePendingChatCounts(snapshot);
      throw err;
    } finally {
      this.isFlushing = false;
    }
  }

  private async flushChannelChatCount(channelId: string) {
    const count = this.pendingChatCounts.get(channelId) || 0;
    if (count <= 0) return;
    this.pendingChatCounts.delete(channelId);
    try {
      await streamerRepository.incrementChatCount(channelId, count);
    } catch (err) {
      this.pendingChatCounts.set(channelId, (this.pendingChatCounts.get(channelId) || 0) + count);
      throw err;
    }
  }

  /**
   * 치지직 채팅 서버 연결용 토큰 획득 API 호출
   */
  private async getChatAccessToken(channelId: string, streamerAccessToken?: string): Promise<{ accessToken: string }> {
    const url = `https://comm-api.game.naver.com/nng_main/v1/chats/access-token?channelId=${channelId}&chatType=STREAMING`;
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json'
    };

    if (streamerAccessToken) {
      headers['Authorization'] = `Bearer ${streamerAccessToken}`;
    }

    const res = await fetch(url, { headers });

    if (!res.ok) {
      throw new Error(`채팅 토큰 요청 실패 (HTTP 상태코드: ${res.status})`);
    }

    const body = (await res.json()) as any;
    if (body.code === 200 && body.content) {
      return {
        accessToken: body.content.accessToken
      };
    }
    throw new Error(body.message || '채팅 토큰 파싱 에러');
  }

  /**
   * 특정 채널의 방송 중 채팅방 웹소켓 연결 시작
   */
  public async connect(channelId: string, chatChannelId: string, streamerAccessToken?: string) {
    // 이 채널은 "연결 유지 대상"으로 표시 (재연결 가드)
    this.desired.add(channelId);

    if (this.connections.has(channelId)) {
      // 이미 연결되어 있으면 추가 연결을 건너뜁니다.
      return;
    }

    console.log(`[ChatManager] 채팅 수집 시작 (스트리머 ID: ${channelId}, 채팅방 ID: ${chatChannelId})`);
    try {
      const { accessToken } = await this.getChatAccessToken(chatChannelId, streamerAccessToken);
      
      // 치지직 기본 웹소켓 서버 주소 분산 매핑 (라이브러리 로직)
      const serverId = Math.abs(
        chatChannelId.split("")
          .map(c => c.charCodeAt(0))
          .reduce((a, b) => a + b)
      ) % 9 + 1;

      const wsUrl = `wss://kr-ss${serverId}.chat.naver.com/chat`;
      const ws = new WebSocket(wsUrl);

      let isJoined = false;
      let currentSid = ''; // 서버로부터 획득할 세션 ID 저장 공간

      ws.on('open', () => {
        // 1. 소켓 연결 후 조인(Connect) 요청 프레임 전송 (공식 라이브러리 검증 규격 적용)
        // 항상 안전하게 auth: 'READ', uid: null 로 조인하여 105, 106 인증 오류를 최종 방어합니다.
        const connectFrame = {
          ver: '2',
          cmd: 100, // CMD_CONNECT
          svcid: 'game',
          cid: chatChannelId,
          bdy: {
            accTkn: accessToken,
            auth: 'READ',
            devType: 2001,
            uid: null
          },
          tid: 1
        };
        ws.send(JSON.stringify(connectFrame));
      });

      ws.on('message', async (data: string) => {
        try {
          const rawMsg = data.toString();
          const frame = JSON.parse(rawMsg) as any;

          // CMD_CONNECT_SUCCESS (10100)
          if (frame.cmd === 10100) {
            if (frame.retCode !== undefined && frame.retCode !== 0) {
              console.error(`[ChatManager] 조인 인증 실패 (에러코드: ${frame.retCode}, 사유: ${frame.retMsg})`);
              ws.close();
              return;
            }
            isJoined = true;
            currentSid = frame.bdy?.sid || frame.sid || ''; // 발급받은 세션 ID 보관
            console.log(`[ChatManager] 채팅방에 성공적으로 조인 완료 (채널: ${channelId}, SID: ${currentSid})`);
          } else if (frame.cmd === 93101 || frame.cmd === 93102) { // 93101: CMD_CHAT, 93102: CMD_DONATION
            // 채팅 수신 시 메모리에 누적하고 주기적으로 채널별 합산 flush합니다.
            const chatCount = Array.isArray(frame.bdy) ? frame.bdy.length : 1;
            this.addPendingChatCount(channelId, chatCount);
          } else if (frame.cmd === 0) { // 서버의 PING 요청에 대한 PONG 처리 (라이브러리 스펙 매핑)
            const pongFrame = {
              ver: '2',
              cmd: 10000 // CMD_PONG
            };
            ws.send(JSON.stringify(pongFrame));
          }
        } catch (parseErr) {
          // 프레임 파싱 무시
        }
      });

      // 주기적으로 생존 여부 체크를 위해 클라이언트가 주기적으로 PING 프레임(cmd: 0)을 전송 (20초 라이브러리 주기 적용)
      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ 
            ver: '2', 
            cmd: 0 
          })); // CMD_PING (세션 ID 불필요)
        }
      }, 20000);

      ws.on('close', () => {
        console.log(`[ChatManager] 웹소켓 연결 닫힘 (채널: ${channelId})`);
        const conn = this.connections.get(channelId);
        const wasExplicitlyClosed = conn?.isExplicitlyClosed;
        this.cleanupConnection(channelId);

        // 명시적 종료가 아니고, 여전히 연결 유지 대상(방송 중)일 때만 5초 후 재연결
        // 방송이 종료되면 scheduler가 disconnect()로 desired에서 제거하므로 재연결하지 않음
        if (!wasExplicitlyClosed && this.desired.has(channelId)) {
          console.log(`[ChatManager] 예기치 못한 종료 감지 -> 5초 후 자동 재연결 시도 (채널: ${channelId})`);
          const timer = setTimeout(() => {
            this.reconnectTimers.delete(channelId);
            // 타이머 발화 시점에도 여전히 연결 대상인지 재확인
            if (this.desired.has(channelId)) {
              this.connect(channelId, chatChannelId, streamerAccessToken);
            }
          }, 5000);
          this.reconnectTimers.set(channelId, timer);
        }
      });

      ws.on('error', (err) => {
        console.error(`[ChatManager] 웹소켓 에러 발생 (채널: ${channelId}):`, err.message);
        ws.close();
      });

      this.connections.set(channelId, { 
        socket: ws, 
        pingInterval,
        chatChannelId,
        streamerAccessToken,
        isExplicitlyClosed: false
      });
    } catch (err: any) {
      console.error(`[ChatManager] 소켓 연결 중 예외 발생 (채널: ${channelId}):`, err);
      if (err.cause) {
        console.error(`[ChatManager] 상세 원인 (Cause):`, err.cause);
      }
    }
  }

  /**
   * 특정 스트리머의 채팅 수집 웹소켓이 정상 연결(OPEN)되어 있는지 여부 반환
   */
  public isConnected(channelId: string): boolean {
    const conn = this.connections.get(channelId);
    if (!conn) return false;
    return conn.socket.readyState === WebSocket.OPEN || conn.socket.readyState === WebSocket.CONNECTING;
  }

  /**
   * 특정 채널 웹소켓 접속 해제 및 정리
   */
  public disconnect(channelId: string) {
    // 더 이상 연결 유지 대상이 아님 → 재연결 가드 해제 및 대기 중 재연결 타이머 취소
    this.desired.delete(channelId);
    const pending = this.reconnectTimers.get(channelId);
    if (pending) {
      clearTimeout(pending);
      this.reconnectTimers.delete(channelId);
    }

    const conn = this.connections.get(channelId);
    if (conn) {
      console.log(`[ChatManager] 채팅 수집 중단 (채널: ${channelId})`);
      conn.isExplicitlyClosed = true;
      conn.socket.close();
      this.cleanupConnection(channelId);
      this.flushChannelChatCount(channelId).catch((err: any) => {
        console.error(`[ChatManager] 채널 flush 실패 (${channelId}):`, err?.message || err);
      });
    }
  }

  /**
   * 전체 소켓 정리
   */
  private cleanupConnection(channelId: string) {
    const conn = this.connections.get(channelId);
    if (conn) {
      if (conn.pingInterval) {
        clearInterval(conn.pingInterval);
      }
      this.connections.delete(channelId);
    }
  }

  /**
   * 서버 종료 시 모든 연결을 해제합니다.
   */
  public disconnectAll() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
    for (const channelId of this.connections.keys()) {
      this.disconnect(channelId);
    }
    this.flushPendingChatCounts().catch((err: any) => {
      console.error('[ChatManager] 전체 disconnect flush 실패:', err?.message || err);
    });
  }
}

export const chatManager = new ChzzkChatManager();

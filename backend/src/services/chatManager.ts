import WebSocket from 'ws';
import { streamerRepository } from '../repositories';

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

  /**
   * 치지직 채팅 서버 연결용 토큰 획득 API 호출
   */
  private async getChatAccessToken(channelId: string, streamerAccessToken?: string): Promise<string> {
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
      return body.content.accessToken;
    }
    throw new Error(body.message || '채팅 토큰 파싱 에러');
  }

  /**
   * 특정 채널의 방송 중 채팅방 웹소켓 연결 시작
   */
  public async connect(channelId: string, chatChannelId: string, streamerAccessToken?: string) {
    if (this.connections.has(channelId)) {
      // 이미 연결되어 있으면 추가 연결을 건너뜁니다.
      return;
    }

    console.log(`[ChatManager] 채팅 수집 시작 (스트리머 ID: ${channelId}, 채팅방 ID: ${chatChannelId})`);
    try {
      const accessToken = await this.getChatAccessToken(chatChannelId, streamerAccessToken);
      
      // 치지직 기본 웹소켓 서버 주소
      const wsUrl = 'wss://kr-ss1.chat.naver.com/chat';
      const ws = new WebSocket(wsUrl);

      let isJoined = false;

      ws.on('open', () => {
        // 1. 소켓 연결 후 조인(Connect) 요청 프레임 전송
        const connectFrame: ChzzkSocketFrame = {
          ver: '3',
          cmd: 100, // CMD_CONNECT
          svcid: 'game',
          cid: chatChannelId,
          sid: '',
          bdy: {
            uid: null,
            devType: 2001,
            accTkn: accessToken,
            authTypes: []
          },
          tid: 1
        };
        ws.send(JSON.stringify(connectFrame));
      });

      ws.on('message', async (data: string) => {
        try {
          const frame = JSON.parse(data) as ChzzkSocketFrame;

          // CMD_CONNECT_SUCCESS (10100) or CMD_SEND_CHAT (93006)
          if (frame.cmd === 10100) {
            isJoined = true;
            console.log(`[ChatManager] 채팅방에 성공적으로 조인 완료 (채널: ${channelId})`);
          } else if (frame.cmd === 93006) { // CMD_SEND_CHAT
            // 채팅 수신 시 DB 카운트 증가
            // frame.bdy가 배열일 수 있으므로 수신된 실시간 대화 수만큼 증가시킵니다.
            const chatCount = Array.isArray(frame.bdy) ? frame.bdy.length : 1;
            await streamerRepository.incrementChatCount(channelId, chatCount);
          } else if (frame.cmd === 0) { // 서버의 PING 요청에 대한 PONG 처리
            const pongFrame: ChzzkSocketFrame = {
              ver: '3',
              cmd: 10000 // CMD_PONG
            };
            ws.send(JSON.stringify(pongFrame));
          }
        } catch (parseErr) {
          // 프레임 파싱 무시
        }
      });

      // 주기적으로 생존 여부 체크를 위해 클라이언트가 주기적으로 PING 프레임(cmd: 0)을 전송 (15초 주기로 최적화)
      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ ver: '3', cmd: 0 })); // CMD_PING
        }
      }, 15000);

      ws.on('close', () => {
        console.log(`[ChatManager] 웹소켓 연결 닫힘 (채널: ${channelId})`);
        const conn = this.connections.get(channelId);
        const wasExplicitlyClosed = conn?.isExplicitlyClosed;
        this.cleanupConnection(channelId);

        // 명시적으로 끊은 경우가 아닌 예기치 못한 끊김인 경우 5초 후 자동 재연결 시도
        if (!wasExplicitlyClosed) {
          console.log(`[ChatManager] 예기치 못한 종료 감지 -> 5초 후 자동 재연결 시도 (채널: ${channelId})`);
          setTimeout(() => {
            this.connect(channelId, chatChannelId, streamerAccessToken);
          }, 5000);
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
    const conn = this.connections.get(channelId);
    if (conn) {
      console.log(`[ChatManager] 채팅 수집 중단 (채널: ${channelId})`);
      conn.isExplicitlyClosed = true;
      conn.socket.close();
      this.cleanupConnection(channelId);
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
    for (const channelId of this.connections.keys()) {
      this.disconnect(channelId);
    }
  }
}

export const chatManager = new ChzzkChatManager();

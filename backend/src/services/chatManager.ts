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
  // 채널 ID별 WebSocket 연결 관리 맵
  private connections: Map<string, { socket: WebSocket; pingInterval?: NodeJS.Timeout }> = new Map();

  /**
   * 치지직 채팅 서버 연결용 토큰 획득 API 호출
   */
  private async getChatAccessToken(channelId: string): Promise<string> {
    const url = `https://comm-api.game.naver.com/nng_main/v1/chats/access-token?channelId=${channelId}&chatType=STREAMING`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });

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
  public async connect(channelId: string, chatChannelId: string) {
    if (this.connections.has(channelId)) {
      // 이미 연결되어 있으면 추가 연결을 건너뜁니다.
      return;
    }

    console.log(`[ChatManager] 채팅 수집 시작 (스트리머 ID: ${channelId}, 채팅방 ID: ${chatChannelId})`);
    try {
      const accessToken = await this.getChatAccessToken(channelId);
      
      // 치지직 기본 웹소켓 서버 주소
      const wsUrl = 'wss://kr-ss1.chat.naver.com/chat';
      const ws = new WebSocket(wsUrl);

      let isJoined = false;

      ws.on('open', () => {
        // 1. 소켓 연결 후 조인(Connect) 요청 프레임 전송
        const connectFrame: ChzzkSocketFrame = {
          ver: '2',
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
              ver: '2',
              cmd: 10000 // CMD_PONG
            };
            ws.send(JSON.stringify(pongFrame));
          }
        } catch (parseErr) {
          // 프레임 파싱 무시
        }
      });

      // 주기적으로 생존 여부 체크를 위해 클라이언트가 주기적으로 PING 프레임(cmd: 0)을 전송
      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ ver: '2', cmd: 0 })); // CMD_PING
        }
      }, 20000);

      ws.on('close', () => {
        console.log(`[ChatManager] 웹소켓 연결 닫힘 (채널: ${channelId})`);
        this.cleanupConnection(channelId);
      });

      ws.on('error', (err) => {
        console.error(`[ChatManager] 웹소켓 에러 발생 (채널: ${channelId}):`, err.message);
        ws.close();
      });

      this.connections.set(channelId, { socket: ws, pingInterval });
    } catch (err: any) {
      console.error(`[ChatManager] 소켓 연결 중 예외 발생 (채널: ${channelId}):`, err);
      if (err.cause) {
        console.error(`[ChatManager] 상세 원인 (Cause):`, err.cause);
      }
    }
  }

  /**
   * 특정 채널 웹소켓 접속 해제 및 정리
   */
  public disconnect(channelId: string) {
    const conn = this.connections.get(channelId);
    if (conn) {
      console.log(`[ChatManager] 채팅 수집 중단 (채널: ${channelId})`);
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

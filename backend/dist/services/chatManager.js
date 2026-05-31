"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.chatManager = void 0;
const ws_1 = __importDefault(require("ws"));
const repositories_1 = require("../repositories");
class ChzzkChatManager {
    // 채널 ID별 WebSocket 연결 관리 맵 (재연결용 메타데이터 보관)
    connections = new Map();
    /**
     * 치지직 채팅 서버 연결용 토큰 및 식별 해시(userIdHash) 획득 API 호출
     */
    async getChatAccessToken(channelId, streamerAccessToken) {
        const url = `https://comm-api.game.naver.com/nng_main/v1/chats/access-token?channelId=${channelId}&chatType=STREAMING`;
        const headers = {
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
        const body = (await res.json());
        if (body.code === 200 && body.content) {
            return {
                accessToken: body.content.accessToken,
                userIdHash: body.content.userIdHash || ''
            };
        }
        throw new Error(body.message || '채팅 토큰 파싱 에러');
    }
    /**
     * 특정 채널의 방송 중 채팅방 웹소켓 연결 시작
     */
    async connect(channelId, chatChannelId, streamerAccessToken) {
        if (this.connections.has(channelId)) {
            // 이미 연결되어 있으면 추가 연결을 건너뜁니다.
            return;
        }
        console.log(`[ChatManager] 채팅 수집 시작 (스트리머 ID: ${channelId}, 채팅방 ID: ${chatChannelId})`);
        try {
            const { accessToken, userIdHash } = await this.getChatAccessToken(chatChannelId, streamerAccessToken);
            // 가상 UUID 생성 헬퍼 함수
            const generateUuid = () => {
                return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
                    const r = Math.random() * 16 | 0;
                    const v = c === 'x' ? r : (r & 0x3 | 0x8);
                    return v.toString(16);
                });
            };
            // 치지직 기본 웹소켓 서버 주소
            const wsUrl = 'wss://kr-ss1.chat.naver.com/chat';
            const ws = new ws_1.default(wsUrl);
            let isJoined = false;
            let currentSid = ''; // 서버로부터 획득할 세션 ID 저장 공간
            ws.on('open', () => {
                // 1. 소켓 연결 후 조인(Connect) 요청 프레임 전송 (전달받은 실기기 패킷 구조 적용)
                // 로그인 인증 수집 시에는 채널 ID를 uid로 전달하고, 비로그인 수집 시에는 null로 설정하여 인증 불일치(105, 106)를 완벽 차단합니다.
                const connectFrame = {
                    ver: '3',
                    cmd: 100, // CMD_CONNECT
                    svcid: 'game',
                    cid: chatChannelId,
                    sid: null,
                    bdy: {
                        uid: streamerAccessToken ? channelId : null,
                        devType: 2001,
                        accTkn: accessToken,
                        auth: 'SEND',
                        libVer: '4.11.0',
                        osVer: 'Linux/',
                        devName: 'Mozilla Firefox/135.0',
                        locale: 'ko',
                        timezone: 'Asia/Seoul',
                        uuid: generateUuid(),
                        windowId: generateUuid()
                    },
                    tid: 1
                };
                ws.send(JSON.stringify(connectFrame));
            });
            ws.on('message', async (data) => {
                try {
                    const frame = JSON.parse(data);
                    // CMD_CONNECT_SUCCESS (10100) or CMD_SEND_CHAT (93006)
                    if (frame.cmd === 10100) {
                        // retCode가 존재하고 0이 아니라면 연결 에러로 판단해 접속 종료
                        if (frame.retCode !== undefined && frame.retCode !== 0) {
                            console.error(`[ChatManager] 조인 인증 실패 (에러코드: ${frame.retCode}, 사유: ${frame.retMsg})`);
                            ws.close();
                            return;
                        }
                        isJoined = true;
                        // 최상위 frame.sid를 우선 참조하고 백업으로 frame.bdy?.sid 참조
                        currentSid = frame.sid || frame.bdy?.sid || '';
                        console.log(`[ChatManager] 채팅방에 성공적으로 조인 완료 (채널: ${channelId}, SID: ${currentSid})`);
                    }
                    else if (frame.cmd === 93006) { // CMD_SEND_CHAT
                        // 채팅 수신 시 DB 카운트 증가
                        // frame.bdy가 배열일 수 있으므로 수신된 실시간 대화 수만큼 증가시킵니다.
                        const chatCount = Array.isArray(frame.bdy) ? frame.bdy.length : 1;
                        await repositories_1.streamerRepository.incrementChatCount(channelId, chatCount);
                    }
                    else if (frame.cmd === 0) { // 서버의 PING 요청에 대한 PONG 처리
                        const pongFrame = {
                            ver: '3',
                            cmd: 10000, // CMD_PONG
                            sid: currentSid
                        };
                        ws.send(JSON.stringify(pongFrame));
                    }
                }
                catch (parseErr) {
                    // 프레임 파싱 무시
                }
            });
            // 주기적으로 생존 여부 체크를 위해 클라이언트가 주기적으로 PING 프레임(cmd: 0)을 전송 (15초 주기로 최적화)
            const pingInterval = setInterval(() => {
                if (ws.readyState === ws_1.default.OPEN) {
                    ws.send(JSON.stringify({
                        ver: '3',
                        cmd: 0,
                        sid: currentSid
                    })); // CMD_PING
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
        }
        catch (err) {
            console.error(`[ChatManager] 소켓 연결 중 예외 발생 (채널: ${channelId}):`, err);
            if (err.cause) {
                console.error(`[ChatManager] 상세 원인 (Cause):`, err.cause);
            }
        }
    }
    /**
     * 특정 스트리머의 채팅 수집 웹소켓이 정상 연결(OPEN)되어 있는지 여부 반환
     */
    isConnected(channelId) {
        const conn = this.connections.get(channelId);
        if (!conn)
            return false;
        return conn.socket.readyState === ws_1.default.OPEN || conn.socket.readyState === ws_1.default.CONNECTING;
    }
    /**
     * 특정 채널 웹소켓 접속 해제 및 정리
     */
    disconnect(channelId) {
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
    cleanupConnection(channelId) {
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
    disconnectAll() {
        for (const channelId of this.connections.keys()) {
            this.disconnect(channelId);
        }
    }
}
exports.chatManager = new ChzzkChatManager();

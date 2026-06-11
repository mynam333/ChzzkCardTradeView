process.env.PROCESS_ROLE = process.env.PROCESS_ROLE || 'chat-worker';

import http from 'http';
import { bootstrapProcess } from '../services/processBootstrap';

bootstrapProcess('ChatWorker');

import { initVapid } from '../controllers/pushController';
import { initRepositories } from '../repositories';
import { initDatabaseConnection } from '../services/db';
import { attachFriendChatSocketServer } from '../services/friendChatSocketServer';
import { getRuntimeStats } from '../services/runtimeStats';
import { setRuntimeStatsProvider, startRuntimeStatsLogging } from '../services/fileLogger';

initVapid();
setRuntimeStatsProvider(getRuntimeStats);
startRuntimeStatsLogging();

const PORT = Number(process.env.CHAT_WORKER_PORT || process.env.PORT || 5001);
const PATH = process.env.CHAT_WS_PATH || '/chat';

let server: http.Server | null = null;
let shuttingDown = false;

const notifyReady = () => {
  if (typeof process.send === 'function') process.send('ready');
};

const shutdown = (signal: NodeJS.Signals) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[ChatWorker] ${signal} 수신. 채팅 WebSocket 서버를 종료합니다.`);
  if (!server) {
    process.exit(0);
    return;
  }
  server.close((err?: Error) => {
    if (err) {
      console.error('[ChatWorker] 종료 중 오류:', err);
      process.exit(1);
      return;
    }
    process.exit(0);
  });
};

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);

const start = async () => {
  try {
    await initDatabaseConnection();
    initRepositories();

    server = http.createServer((req, res) => {
      if (req.url?.startsWith('/health')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          role: 'chat-worker',
          path: PATH,
          runtime: getRuntimeStats(),
          timestamp: new Date().toISOString()
        }));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'NotFound' }));
    });

    attachFriendChatSocketServer(server, PATH);
    server.listen(PORT, () => {
      console.log(`[ChatWorker] 친구 1:1 톡 WebSocket 서버가 ws://localhost:${PORT}${PATH} 에서 실행 중입니다.`);
      notifyReady();
    });
  } catch (err) {
    console.error('[ChatWorker] 시작 실패:', err);
    process.exit(1);
  }
};

start();

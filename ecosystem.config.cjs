module.exports = {
  apps: [
    {
      name: 'chikapo-api',
      cwd: __dirname,
      script: 'backend/dist/server.js',
      instances: process.env.API_INSTANCES || 2,
      exec_mode: 'cluster',
      wait_ready: true,
      listen_timeout: 15000,
      kill_timeout: 15000,
      max_memory_restart: '900M',
      env: {
        NODE_ENV: 'production',
        PROCESS_ROLE: 'api'
      }
    },
    {
      name: 'chikapo-live-worker',
      cwd: __dirname,
      script: 'backend/dist/workers/liveStatusWorker.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '700M',
      env: {
        NODE_ENV: 'production',
        PROCESS_ROLE: 'live-worker'
      }
    },
    {
      name: 'chikapo-scheduler-worker',
      cwd: __dirname,
      script: 'backend/dist/workers/schedulerWorker.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PROCESS_ROLE: 'scheduler-worker'
      }
    },
    {
      name: 'chikapo-backup-worker',
      cwd: __dirname,
      script: 'backend/dist/workers/backupWorker.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '700M',
      env: {
        NODE_ENV: 'production',
        PROCESS_ROLE: 'backup-worker'
      }
    },
    {
      name: 'chikapo-image-worker',
      cwd: __dirname,
      script: 'backend/dist/workers/imageProxyWorker.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '600M',
      env: {
        NODE_ENV: 'production',
        PROCESS_ROLE: 'image-worker'
      }
    }
  ]
};

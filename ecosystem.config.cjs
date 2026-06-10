module.exports = {
  apps: [
    {
      name: 'chikapo-api',
      cwd: __dirname,
      script: 'backend/dist/server.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '900M',
      env: {
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
        PROCESS_ROLE: 'image-worker'
      }
    }
  ]
};

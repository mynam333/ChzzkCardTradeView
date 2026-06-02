import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // config.ts가 부팅 시 요구하는 필수 환경변수를 테스트 환경에 주입
    env: {
      JWT_SECRET: 'test_secret_for_vitest_only',
      NODE_ENV: 'test'
    },
    include: ['src/**/*.test.ts']
  }
});

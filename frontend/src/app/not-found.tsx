import { redirect } from 'next/navigation';

/**
 * 정의되지 않은 경로(404 에러)로 진입한 사용자를 치카포 메인 홈(/)으로 자동 리다이렉트 처리
 */
export default function NotFound() {
  redirect('/');
}

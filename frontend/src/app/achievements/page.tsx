import type { Metadata } from 'next';
import { MainLayout } from '../MainLayout';
import { AchievementsTab } from '../AchievementsTab';

export const metadata: Metadata = { title: '업적&미션' };

export default function AchievementsPage() {
  return (
    <MainLayout>
      <AchievementsTab />
    </MainLayout>
  );
}

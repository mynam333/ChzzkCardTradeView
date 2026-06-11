'use client';

import React from 'react';
import { MainLayout } from '../MainLayout';
import { FriendTab } from '../FriendTab';

/**
 * 치카포 친구 페이지 (/friends)
 */
export default function FriendsPage() {
  return (
    <MainLayout>
      <FriendTab />
    </MainLayout>
  );
}

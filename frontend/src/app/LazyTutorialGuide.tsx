'use client';

import dynamic from 'next/dynamic';

const TutorialGuide = dynamic(
  () => import('./TutorialGuide').then((module) => module.TutorialGuide),
  { ssr: false }
);

export const LazyTutorialGuide = () => <TutorialGuide />;

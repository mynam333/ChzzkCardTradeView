import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../..');
const fallbackSources = [
  'frontend/src/app/AdminTitlesTab.tsx',
  'frontend/src/app/auth/chzzk/callback/page.tsx',
  'frontend/src/app/FriendTab.tsx',
  'frontend/src/app/TutorialGuide.tsx',
  'backend/src/controllers/friendController.ts',
  'backend/src/controllers/playController.ts',
  'backend/src/services/chzzkService.ts',
  'backend/src/services/friendChatService.ts'
];

describe('avatar fallback raster contract', () => {
  it('keeps DiceBear fallbacks on the safe PNG endpoint', () => {
    const combined = fallbackSources
      .map((relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'))
      .join('\n');

    expect(combined).toContain('api.dicebear.com');
    expect(combined).toMatch(/dicebear[^\s`'"?]*\/png\?seed=/);
    expect(combined).not.toMatch(/dicebear[^\s`'"?]*\/svg\?seed=/);
  });

  it('continues routing the ProfileModal avatar through the sanitized image proxy', () => {
    const profileModal = fs.readFileSync(
      path.join(repoRoot, 'frontend/src/app/ProfileModal.tsx'),
      'utf8'
    );
    expect(profileModal).toMatch(
      /proxiedImage\(profile\.avatar_url,\s*\{\s*width:\s*112,\s*quality:\s*76\s*\}\)/
    );
  });
});

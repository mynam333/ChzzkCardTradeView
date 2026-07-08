import { ArenaV2MatchPageClient } from '../ArenaV2MatchPageClient';

export function generateStaticParams() {
  return [{ match_id: '__static_export_placeholder__' }];
}

export default async function ArenaMatchDynamicPage({
  params
}: {
  params: Promise<{ match_id?: string }>;
}) {
  const resolvedParams = await params;
  return <ArenaV2MatchPageClient matchId={resolvedParams.match_id || null} />;
}

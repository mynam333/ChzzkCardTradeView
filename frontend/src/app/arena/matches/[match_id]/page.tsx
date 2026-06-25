import { ArenaMatchPageClient } from '../ArenaMatchPageClient';

export const dynamicParams = false;

export function generateStaticParams() {
  return [{ match_id: '__static_export_placeholder__' }];
}

export default async function ArenaMatchDynamicPage({
  params
}: {
  params: Promise<{ match_id?: string }> | { match_id?: string };
}) {
  const resolvedParams = await params;
  return <ArenaMatchPageClient matchId={resolvedParams.match_id || null} />;
}

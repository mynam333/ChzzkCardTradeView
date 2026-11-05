import { getDbMode, getMysqlDb, getSqliteDb, getSupabaseClient } from './db';

export type PendingMarketCardListing = {
  id: number;
  user_card_id: number;
  status: 'PENDING';
  listing_type: 'fixed' | 'auction';
  auction_ends_at: string | null;
};

const normalizePendingListing = (row: any): PendingMarketCardListing => ({
  id: Number(row.id),
  user_card_id: Number(row.user_card_id),
  status: 'PENDING',
  listing_type: row.listing_type === 'auction' ? 'auction' : 'fixed',
  auction_ends_at: row.auction_ends_at == null ? null : String(row.auction_ends_at)
});

export const listPendingMarketCardsBySeller = async (sellerId: string): Promise<PendingMarketCardListing[]> => {
  const mode = getDbMode();
  if (mode === 'MYSQL') {
    const rows = await getMysqlDb().all<any>(`
      SELECT id, user_card_id, listing_type, auction_ends_at
        FROM market_listings
       WHERE seller_id = ? AND status = 'PENDING'
    `, sellerId);
    return rows.map(normalizePendingListing);
  }

  if (mode === 'SUPABASE') {
    const rows: any[] = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await getSupabaseClient()
        .from('market_listings')
        .select('id,user_card_id,listing_type,auction_ends_at')
        .eq('seller_id', sellerId)
        .eq('status', 'PENDING')
        .order('id', { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) throw error;
      rows.push(...(data || []));
      if ((data?.length || 0) < pageSize) break;
    }
    return rows.map(normalizePendingListing);
  }

  const rows = getSqliteDb().prepare(`
    SELECT id, user_card_id, listing_type, auction_ends_at
      FROM market_listings
     WHERE seller_id = ? AND status = 'PENDING'
  `).all(sellerId) as any[];
  return rows.map(normalizePendingListing);
};

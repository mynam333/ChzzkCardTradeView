import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shopSource = readFileSync(new URL('./ShopTab.tsx', import.meta.url), 'utf8');
const tutorialSource = readFileSync(new URL('./TutorialGuide.tsx', import.meta.url), 'utf8');

const sliceBetween = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing source marker: ${startMarker}`);
  assert.ok(end > start, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
};

const activeMarketCards = sliceBetween(
  shopSource,
  '{marketListings.map((listing) => {',
  '{/* 오픈마켓 페이지네이션 바 */}'
);
const myListings = sliceBetween(
  shopSource,
  '{myListings.map((l) => {',
  '</tbody>'
);
const marketHistory = sliceBetween(
  shopSource,
  '{paginatedHistory.map((l) => {',
  '</tbody>'
);

test('active auctions show only the starting price and the viewer own bid', () => {
  assert.match(activeMarketCards, /<span>시작가<\/span>/);
  assert.match(activeMarketCards, /<span>내 입찰가<\/span>/);
  assert.match(activeMarketCards, /formatMarketPrice\(myBid\)/);
  assert.match(activeMarketCards, /진행 중 입찰가 비공개 \(판매자 포함\)/);
  assert.doesNotMatch(activeMarketCards, /highest_bid|highestBid|최고 제시/);
});

test('seller listing management uses a non-price has_bids flag for cancellation', () => {
  assert.match(myListings, /const auctionHasBids = isAuction && l\.has_bids === true/);
  assert.match(myListings, /disabled=\{cancellingListingId === l\.id \|\| auctionHasBids\}/);
  assert.match(myListings, /진행 중 입찰가 비공개 \(판매자 포함\)/);
  assert.doesNotMatch(myListings, /highest_bid|highestBid|최고 제시/);
});

test('completed private history keeps only the finalized auction price', () => {
  assert.match(marketHistory, /const winningPrice = Math\.max/);
  assert.match(marketHistory, /실제 낙찰 \{formatMarketPrice\(winningPrice\)\} P/);
  assert.doesNotMatch(marketHistory, /highest_bid|highestBid|최고 제시/);
});

test('volatile patches track privacy-safe bid state and the guide explains sealed bids', () => {
  const volatileKeys = sliceBetween(shopSource, 'const MARKET_LISTING_VOLATILE_KEYS', '];');
  assert.match(volatileKeys, /'my_bid'/);
  assert.match(volatileKeys, /'has_bids'/);
  assert.doesNotMatch(volatileKeys, /'highest_bid'/);
  assert.match(tutorialSource, /진행 중인 경매의 입찰가는 판매자를 포함해 누구에게도 공개되지 않으며/);
});

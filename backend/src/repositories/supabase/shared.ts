import { Streamer } from "../interfaces";
// Supabase 공용 헬퍼 (별 이미지 컬럼)
export const STAR_IMAGE_COLUMNS = [
  'custom_image_url', 'custom_image_url_1', 'custom_image_url_2',
  'custom_image_url_3', 'custom_image_url_4', 'custom_image_url_5'
];

// row에 별별 커스텀 이미지 배열(custom_images)을 부여
export const withStarImages = (row: any): Streamer => ({
  ...(row as Streamer),
  custom_images: STAR_IMAGE_COLUMNS.map((col) => row[col] ?? null)
});

// 2. Supabase 스트리머 레포지토리

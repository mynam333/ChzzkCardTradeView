import { Streamer } from "../interfaces";
import { formatUploadUrl } from "../../services/imageService";

// Supabase 공용 헬퍼 (별 이미지 컬럼)
export const STAR_IMAGE_COLUMNS = [
  'custom_image_url', 'custom_image_url_1', 'custom_image_url_2',
  'custom_image_url_3', 'custom_image_url_4', 'custom_image_url_5'
];

// row에 별별 커스텀 이미지 배열(custom_images)을 부여하며 업로드 URL 포맷팅 적용
export const withStarImages = (row: any): Streamer => {
  if (!row) return row;
  const customImages = STAR_IMAGE_COLUMNS.map((col) => formatUploadUrl(row[col]) ?? null);
  return {
    ...(row as Streamer),
    custom_image_url: formatUploadUrl(row.custom_image_url),
    custom_images: customImages
  };
};

// 2. Supabase 스트리머 레포지토리

// SQLite 공용 헬퍼 (별 이미지 컬럼)
export const STAR_IMAGE_COLUMNS = [
  'custom_image_url', 'custom_image_url_1', 'custom_image_url_2',
  'custom_image_url_3', 'custom_image_url_4', 'custom_image_url_5'
];

// row에서 별별 커스텀 이미지 배열을 추출
export const extractStarImages = (row: any): (string | null)[] =>
  STAR_IMAGE_COLUMNS.map((col) => row[col] ?? null);

// 2. SQLite 스트리머 레포지토리

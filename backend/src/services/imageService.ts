import sharp from 'sharp';

/**
 * 업로드된 이미지 버퍼를 받아 최대 가로/세로 1280px 범위 내에서
 * 원본 종횡비를 유지하며 리사이징하고, WebP 포맷으로 변환합니다.
 *
 * @param fileBuffer 원본 이미지 바이너리 버퍼
 * @returns WebP 포맷으로 인코딩된 리사이즈 이미지 버퍼
 */
export const resizeAndConvertToWebp = async (fileBuffer: Buffer): Promise<Buffer> => {
  try {
    const image = sharp(fileBuffer);
    const metadata = await image.metadata();

    let width = metadata.width;
    let height = metadata.height;
    const MAX_SIZE = 1280;

    // 1280px를 초과할 경우 비율 리사이즈 계산
    if (width && height && (width > MAX_SIZE || height > MAX_SIZE)) {
      if (width > height) {
        height = Math.round((height * MAX_SIZE) / width);
        width = MAX_SIZE;
      } else {
        width = Math.round((width * MAX_SIZE) / height);
        height = MAX_SIZE;
      }
    }

    // 리사이징 적용 및 WebP 포맷(압축 품질 80%)으로 인코딩
    const processedBuffer = await image
      .resize(width, height)
      .webp({ quality: 80 })
      .toBuffer();

    return processedBuffer;
  } catch (error: any) {
    console.error('[ImageService] 이미지 가공 중 오류 발생:', error);
    throw new Error(`이미지 변환 실패: ${error.message}`);
  }
};

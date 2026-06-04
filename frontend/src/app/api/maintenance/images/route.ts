import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    const dirPath = path.join(process.cwd(), 'public', 'construction');
    if (!fs.existsSync(dirPath)) {
      return NextResponse.json({ images: [] });
    }

    const files = fs.readdirSync(dirPath);
    // 이미지 확장자 필터링
    const images = files.filter((file) => {
      const ext = path.extname(file).toLowerCase();
      return ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext);
    });

    return NextResponse.json({ images });
  } catch (error) {
    console.error('Failed to read construction images:', error);
    return NextResponse.json({ images: [] }, { status: 500 });
  }
}

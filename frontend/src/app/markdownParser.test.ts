import test from 'node:test';
import assert from 'node:assert';
import { parseMarkdown, parseLineContent } from './markdownParser';

test('parseLineContent - 일반 텍스트 파싱', () => {
  const result = parseLineContent('Hello World');
  assert.deepStrictEqual(result, [
    { type: 'text', content: 'Hello World' }
  ]);
});

test('parseLineContent - 볼드 텍스트 파싱', () => {
  const result = parseLineContent('Hello **World** Bold');
  assert.deepStrictEqual(result, [
    { type: 'text', content: 'Hello ' },
    { type: 'bold', content: 'World' },
    { type: 'text', content: ' Bold' }
  ]);
});

test('parseLineContent - 링크 텍스트 파싱', () => {
  const result = parseLineContent('Click [Chzzk](https://chzzk.naver.com) here');
  assert.deepStrictEqual(result, [
    { type: 'text', content: 'Click ' },
    { type: 'link', text: 'Chzzk', url: 'https://chzzk.naver.com' },
    { type: 'text', content: ' here' }
  ]);
});

test('parseMarkdown - 복합 공지사항 문법 파싱', () => {
  const markdown = `**중요 공지사항**
- 첫 번째 항목 [링크](https://test.com) 완료
- 두 번째 항목 **강조** 완료

일반 텍스트 줄바꿈`;

  const result = parseMarkdown(markdown);
  
  // 라인 수 검증 (5줄)
  assert.strictEqual(result.length, 5);
  
  // 첫 번째 라인 (Bold)
  assert.deepStrictEqual(result[0], {
    type: 'normal',
    tokens: [{ type: 'bold', content: '중요 공지사항' }]
  });

  // 두 번째 라인 (Bullet + Link)
  assert.deepStrictEqual(result[1], {
    type: 'bullet',
    tokens: [
      { type: 'text', content: '첫 번째 항목 ' },
      { type: 'link', text: '링크', url: 'https://test.com' },
      { type: 'text', content: ' 완료' }
    ]
  });

  // 세 번째 라인 (Bullet + Bold)
  assert.deepStrictEqual(result[2], {
    type: 'bullet',
    tokens: [
      { type: 'text', content: '두 번째 항목 ' },
      { type: 'bold', content: '강조' },
      { type: 'text', content: ' 완료' }
    ]
  });

  // 네 번째 라인 (빈 줄)
  assert.deepStrictEqual(result[3], { type: 'empty' });

  // 다섯 번째 라인 (Normal Text)
  assert.deepStrictEqual(result[4], {
    type: 'normal',
    tokens: [{ type: 'text', content: '일반 텍스트 줄바꿈' }]
  });
});

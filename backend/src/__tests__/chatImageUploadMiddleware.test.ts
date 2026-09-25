import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uploadChatImage, uploadSingleImage } from '../routes/api';

const makeImageForm = () => {
  const form = new FormData();
  form.append('image', new Blob([Buffer.from('test-image')], { type: 'image/png' }), 'image.png');
  return form;
};

describe('chat image multipart upload middleware', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.post('/upload', uploadChatImage, (req: any, res) => {
      res.status(200).json({
        fieldname: req.file?.fieldname,
        mimetype: req.file?.mimetype,
        size: req.file?.size
      });
    });
    app.post('/general-upload', uploadSingleImage, (req: any, res) => {
      res.status(200).json({
        fieldCount: Object.keys(req.body || {}).length,
        fieldname: req.file?.fieldname
      });
    });

    server = await new Promise<Server>((resolve) => {
      const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('테스트 서버 포트를 확인할 수 없습니다.');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('accepts the single image part sent by the 1:1 chat client', async () => {
    const response = await fetch(`${baseUrl}/upload`, {
      method: 'POST',
      body: makeImageForm()
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      fieldname: 'image',
      mimetype: 'image/png',
      size: 10
    });
  });

  it('continues to reject multipart text fields', async () => {
    const form = makeImageForm();
    form.append('caption', 'not-allowed');

    const response = await fetch(`${baseUrl}/upload`, {
      method: 'POST',
      body: form
    });

    expect(response.status).toBe(400);
  });

  it('continues to reject a second file', async () => {
    const form = makeImageForm();
    form.append('image', new Blob([Buffer.from('second')], { type: 'image/png' }), 'second.png');

    const response = await fetch(`${baseUrl}/upload`, {
      method: 'POST',
      body: form
    });

    expect(response.status).toBe(400);
  });

  it('accepts the documented general upload boundary of one file and four fields', async () => {
    const form = new FormData();
    for (let index = 0; index < 4; index += 1) form.append(`field_${index}`, String(index));
    form.append('image', new Blob([Buffer.from('test-image')], { type: 'image/png' }), 'image.png');

    const response = await fetch(`${baseUrl}/general-upload`, {
      method: 'POST',
      body: form
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ fieldCount: 4, fieldname: 'image' });
  });

  it('continues to reject a fifth general upload field', async () => {
    const form = new FormData();
    for (let index = 0; index < 5; index += 1) form.append(`field_${index}`, String(index));
    form.append('image', new Blob([Buffer.from('test-image')], { type: 'image/png' }), 'image.png');

    const response = await fetch(`${baseUrl}/general-upload`, {
      method: 'POST',
      body: form
    });

    expect(response.status).toBe(400);
  });
});

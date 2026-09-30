import { describe, expect, it } from 'vitest';
import { asImage } from './satelliteImage';

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe('asImage', () => {
  it('retypes a mislabelled image by its magic bytes', async () => {
    expect((await asImage(new Blob([new Uint8Array(JPEG)], { type: 'application/octet-stream' })))?.type).toBe('image/jpeg');
    expect((await asImage(new Blob([new Uint8Array(PNG)], { type: 'image/jpeg' })))?.type).toBe('image/png');
    const png = new Blob([new Uint8Array(PNG)], { type: 'image/png' });
    expect(await asImage(png)).toBe(png);
  });

  it('takes a 200 JSON or XML error, labelled as an image or not, as no data', async () => {
    expect(await asImage(new Blob(['{"error":{"code":500}}'], { type: 'image/png' }))).toBeNull();
    expect(await asImage(new Blob(['{"error":"Invalid level"}'], { type: 'text/plain' }))).toBeNull();
    expect(await asImage(new Blob(['<?xml version="1.0"?><ServiceExceptionReport/>'], { type: 'text/xml' }))).toBeNull();
    expect(await asImage(new Blob([]))).toBeNull();
    expect(await asImage(null)).toBeNull();
  });
});

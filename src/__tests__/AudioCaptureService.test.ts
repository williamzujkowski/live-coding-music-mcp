import { AudioCaptureService } from '../services/AudioCaptureService';

describe('AudioCaptureService', () => {
  const originalWindow = (globalThis as any).window;
  const originalBtoa = (globalThis as any).btoa;

  afterEach(() => {
    (globalThis as any).window = originalWindow;
    (globalThis as any).btoa = originalBtoa;
  });

  test('stopCapture rehydrates browser Blob payload into a Node-side Blob', async () => {
    const page = {
      evaluate: jest.fn(async (fn: () => Promise<unknown>) => {
        (globalThis as any).window = {
          strudelAudioCapture: {
            stopCapture: jest.fn(async () => ({
              success: true,
              blob: new Blob(['test audio data'], { type: 'audio/webm;codecs=opus' }),
              duration: 1234,
              format: 'audio/webm;codecs=opus',
            })),
          },
        };
        (globalThis as any).btoa = (binary: string) => Buffer.from(binary, 'binary').toString('base64');
        return await fn();
      }),
    };

    const service = new AudioCaptureService();
    const result = await service.stopCapture(page as any);

    expect(result.duration).toBe(1234);
    expect(result.format).toBe('audio/webm;codecs=opus');
    expect(typeof result.blob.arrayBuffer).toBe('function');
    await expect(result.blob.text()).resolves.toBe('test audio data');
  });
});

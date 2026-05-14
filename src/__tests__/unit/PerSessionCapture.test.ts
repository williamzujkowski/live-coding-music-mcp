/**
 * Per-session AudioCaptureService isolation (#180).
 *
 * Verifies that two named sessions get distinct service instances and
 * that destroying a session releases its instance.
 */

jest.mock('../../services/StrudelEngine');
jest.mock('../../services/AudioCaptureService');

import { AudioCaptureService } from '../../services/AudioCaptureService';
import { StrudelMCPServer } from '../../server/server';

describe('per-session AudioCaptureService (#180)', () => {
  let server: any;

  beforeEach(() => {
    server = new StrudelMCPServer();
    (AudioCaptureService as jest.MockedClass<typeof AudioCaptureService>).mockClear();

    // Mock the session manager to return controllers with mock pages
    server.sessionManager.getSession = jest.fn((id: string) => {
      if (id === 'A' || id === 'B') {
        return { page: { __id: id } } as any;
      }
      return undefined;
    });

    // Pretend default session is initialized so the default path doesn't throw.
    // `_page` is the writable getter source on StrudelController; mock at that level.
    server.isInitialized = true;
    Object.defineProperty(server.controller, 'page', {
      get: () => ({ __id: 'default-page' }),
      configurable: true,
    });
  });

  it('two named sessions get distinct service instances', async () => {
    const a = await server.getAudioCaptureService('A');
    const b = await server.getAudioCaptureService('B');
    expect(a).not.toBe(b);
    expect(server.audioCaptureServices.size).toBe(2);
  });

  it('repeated calls for the same session return the cached instance', async () => {
    const a1 = await server.getAudioCaptureService('A');
    const a2 = await server.getAudioCaptureService('A');
    expect(a1).toBe(a2);
    expect(server.audioCaptureServices.size).toBe(1);
  });

  it('default-session call uses the legacy controller page', async () => {
    const def = await server.getAudioCaptureService();
    expect(def).toBeDefined();
    expect(server.audioCaptureServices.has('default')).toBe(true);
  });

  it('non-existent session id throws (dispatcher renders as err business)', async () => {
    await expect(server.getAudioCaptureService('nope')).rejects.toThrow(/Session 'nope' not found/);
  });

  it('session with no page yet throws explicitly', async () => {
    server.sessionManager.getSession = jest.fn(() => ({ page: null }) as any);
    await expect(server.getAudioCaptureService('not-ready')).rejects.toThrow(/no active page/);
  });

  it('dropping a session removes its service entry', async () => {
    await server.getAudioCaptureService('A');
    expect(server.audioCaptureServices.has('A')).toBe(true);
    server.audioCaptureServices.delete('A');
    expect(server.audioCaptureServices.has('A')).toBe(false);
  });

  it('default-session and named sessions are independently tracked', async () => {
    await server.getAudioCaptureService();      // default
    await server.getAudioCaptureService('A');
    expect(server.audioCaptureServices.has('default')).toBe(true);
    expect(server.audioCaptureServices.has('A')).toBe(true);
    expect(server.audioCaptureServices.size).toBe(2);
  });
});

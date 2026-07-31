import {
  MiniMaxMusicService,
  type MiniMaxMusicRequest,
} from '../../services/MiniMaxMusicService.js';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('MiniMaxMusicService', () => {
  let fetchImpl: jest.Mock;
  let service: MiniMaxMusicService;

  beforeEach(() => {
    fetchImpl = jest.fn();
    service = new MiniMaxMusicService({
      apiKey: 'unit-key',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
  });

  it('sends generation fields to the global endpoint and parses URL audio', async () => {
    fetchImpl.mockResolvedValue(
      response({
        base_resp: { status_code: 0 },
        data: { status: 2, audio: 'https://audio.example/generated.mp3' },
      })
    );

    const request: MiniMaxMusicRequest = {
      model: 'music-3.0',
      prompt: 'A restrained ambient instrumental',
      lyrics: 'A quiet night',
      output_format: 'url',
      audio_setting: { format: 'mp3', sample_rate: 44100, bitrate: 128000, channel: 2 },
      lyrics_optimizer: true,
      is_instrumental: false,
    };
    const result = await service.generateMusic(request);

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.minimax.io/v1/music_generation',
      expect.objectContaining({ method: 'POST' })
    );
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toEqual({
      Authorization: 'Bearer unit-key',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(init.body))).toEqual(request);
    expect(result).toEqual({
      status: 'completed',
      status_code: 0,
      audio: 'https://audio.example/generated.mp3',
      output_format: 'url',
      audio_format: 'mp3',
      region: 'global_en',
      model: 'music-3.0',
      url_ttl_hours: 24,
    });
  });

  it('routes China requests and forwards the regional watermark field', async () => {
    fetchImpl.mockResolvedValue(
      response({
        base_resp: { status_code: 0 },
        data: { status: 2, audio: 'ab12' },
      })
    );

    await service.generateMusic({
      model: 'music-2.6',
      region: 'cn_zh',
      output_format: 'hex',
      aigc_watermark: true,
    });

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://api.minimaxi.com/v1/music_generation');
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'music-2.6',
      output_format: 'hex',
      aigc_watermark: true,
    });
  });

  it('combines streamed hexadecimal audio chunks and parses SSE framing', async () => {
    fetchImpl.mockResolvedValue(
      new Response(
        [
          `data: ${JSON.stringify({ data: { status: 1, audio: 'ab' } })}`,
          `data: ${JSON.stringify({ data: { status: 2, audio: 'cd' }, base_resp: { status_code: 0 } })}`,
          'data: [DONE]',
        ].join('\n')
      )
    );

    const result = await service.generateMusic({ model: 'music-3.0', stream: true });

    expect(result.status).toBe('completed');
    expect(result.output_format).toBe('hex');
    expect(result.audio).toBe('abcd');
  });

  it('rejects URL output for streaming requests', async () => {
    await expect(
      service.generateMusic({ model: 'music-3.0', stream: true, output_format: 'url' })
    ).rejects.toThrow('only supports hexadecimal output');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects the regional watermark on the global endpoint', async () => {
    await expect(
      service.generateMusic({ model: 'music-3.0', aigc_watermark: true })
    ).rejects.toThrow('only supported for the China music endpoint');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('surfaces a non-zero API status code', async () => {
    fetchImpl.mockResolvedValue(
      response({
        base_resp: { status_code: 1004, status_msg: 'invalid request' },
        data: { status: 2 },
      })
    );

    await expect(service.generateMusic({ model: 'music-3.0' })).rejects.toThrow('invalid request');
  });
});

import { execute, tools } from '../../server/tools/music.js';
import type { ToolContext } from '../../server/tools/types.js';

describe('generate_music tool', () => {
  it('exposes the generation models, output formats, and audio formats', () => {
    const tool = tools[0];
    const schema = tool?.inputSchema as any;

    expect(tool?.name).toBe('generate_music');
    expect(schema.required).toEqual(['model']);
    expect(schema.properties.model.enum).toEqual([
      'music-3.0',
      'music-2.6',
      'music-3.0-free',
      'music-2.6-free',
    ]);
    expect(schema.properties.output_format.enum).toEqual(['url', 'hex']);
    expect(schema.properties.audio_setting.properties.format.enum).toEqual(['mp3', 'wav', 'pcm']);
  });

  it('forwards the request to the injected service', async () => {
    const generateMusic = jest.fn().mockResolvedValue({
      status: 'completed',
      status_code: 0,
      audio: 'feed',
      output_format: 'hex',
      region: 'global_en',
      model: 'music-3.0',
    });
    const ctx = { miniMaxMusicService: { generateMusic } } as unknown as ToolContext;
    const args = {
      model: 'music-3.0',
      prompt: 'A bright instrumental',
      stream: true,
      output_format: 'hex',
      audio_setting: { format: 'wav' },
      lyrics_optimizer: false,
      is_instrumental: true,
      region: 'global_en',
    };

    const result = await execute('generate_music', args, ctx);

    expect(generateMusic).toHaveBeenCalledWith(args);
    expect(result).toEqual(expect.objectContaining({ audio: 'feed', status: 'completed' }));
  });
});

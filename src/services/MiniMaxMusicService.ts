export const MINIMAX_MUSIC_ENDPOINTS = {
  global_en: 'https://api.minimax.io/v1/music_generation',
  cn_zh: 'https://api.minimaxi.com/v1/music_generation',
} as const;

export const MINIMAX_MUSIC_MODELS = [
  'music-3.0',
  'music-2.6',
  'music-3.0-free',
  'music-2.6-free',
] as const;

export const MINIMAX_MUSIC_OUTPUT_FORMATS = ['url', 'hex'] as const;
export const MINIMAX_MUSIC_AUDIO_FORMATS = ['mp3', 'wav', 'pcm'] as const;

export type MiniMaxMusicRegion = keyof typeof MINIMAX_MUSIC_ENDPOINTS;
export type MiniMaxMusicModel = (typeof MINIMAX_MUSIC_MODELS)[number];
export type MiniMaxMusicOutputFormat = (typeof MINIMAX_MUSIC_OUTPUT_FORMATS)[number];
export type MiniMaxMusicAudioFormat = (typeof MINIMAX_MUSIC_AUDIO_FORMATS)[number];

export interface MiniMaxAudioSetting {
  format?: MiniMaxMusicAudioFormat;
  sample_rate?: number;
  bitrate?: number;
  channel?: number;
  [key: string]: unknown;
}

export interface MiniMaxMusicRequest {
  model: MiniMaxMusicModel;
  prompt?: string;
  lyrics?: string;
  stream?: boolean;
  output_format?: MiniMaxMusicOutputFormat;
  audio_setting?: MiniMaxAudioSetting;
  lyrics_optimizer?: boolean;
  is_instrumental?: boolean;
  region?: MiniMaxMusicRegion;
  aigc_watermark?: boolean;
}

export interface MiniMaxMusicResult {
  status: 'in_progress' | 'completed';
  status_code: number;
  audio: string;
  output_format: MiniMaxMusicOutputFormat;
  audio_format?: MiniMaxMusicAudioFormat;
  region: MiniMaxMusicRegion;
  model: MiniMaxMusicModel;
  url_ttl_hours?: number;
}

interface MiniMaxMusicResponse {
  base_resp?: {
    status_code?: number;
    status_msg?: string;
  };
  data?: {
    status?: number;
    audio?: string;
  };
}

export interface MiniMaxMusicServiceOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.includes(value as T);
}

/** Calls the MiniMax music-generation API for both supported regions. */
export class MiniMaxMusicService {
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: MiniMaxMusicServiceOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.MINIMAX_API_KEY;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey);
  }

  /** Generate music and return the API's URL or hexadecimal audio payload. */
  async generateMusic(request: MiniMaxMusicRequest): Promise<MiniMaxMusicResult> {
    this.validateRequest(request);

    if (!this.apiKey) {
      throw new Error('MiniMax API key not configured. Set MINIMAX_API_KEY to generate music.');
    }

    const region = request.region ?? 'global_en';
    const response = await this.request(region, this.toPayload(request, region));
    const payloads = this.parsePayloads(response.body, response.ok, response.status);

    if (!response.ok) {
      throw new Error(this.formatHttpError(response.status, payloads));
    }

    const baseResponse = [...payloads]
      .reverse()
      .find((payload) => payload.base_resp !== undefined)?.base_resp;
    if (baseResponse?.status_code !== 0) {
      throw new Error(
        `MiniMax music generation failed: ${baseResponse?.status_msg ?? 'unknown API error'}`
      );
    }

    const statusCode = [...payloads]
      .reverse()
      .find((payload) => typeof payload.data?.status === 'number')?.data?.status;
    if (statusCode !== 1 && statusCode !== 2) {
      throw new Error('MiniMax music generation returned an invalid status.');
    }

    const audioParts = payloads
      .map((payload) => payload.data?.audio)
      .filter((audio): audio is string => typeof audio === 'string' && audio.length > 0);
    const audio = request.stream ? audioParts.join('') : (audioParts.at(-1) ?? '');
    if (statusCode === 2 && audio.length === 0) {
      throw new Error('MiniMax music generation completed without audio data.');
    }

    const outputFormat = request.stream ? 'hex' : (request.output_format ?? 'hex');
    return {
      status: statusCode === 2 ? 'completed' : 'in_progress',
      status_code: baseResponse?.status_code ?? 0,
      audio,
      output_format: outputFormat,
      audio_format: request.audio_setting?.format,
      region,
      model: request.model,
      ...(outputFormat === 'url' ? { url_ttl_hours: 24 } : {}),
    };
  }

  private async request(
    region: MiniMaxMusicRegion,
    payload: Record<string, unknown>
  ): Promise<{ body: string; ok: boolean; status: number }> {
    let response: Response;
    try {
      response = await this.fetchImpl(MINIMAX_MUSIC_ENDPOINTS[region], {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`MiniMax music generation network request failed: ${message}`);
    }

    return { body: await response.text(), ok: response.ok, status: response.status };
  }

  private parsePayloads(body: string, responseOk: boolean, status: number): MiniMaxMusicResponse[] {
    const trimmed = body.trim();
    if (trimmed.length === 0) {
      throw new Error(`MiniMax music generation returned an empty response (HTTP ${status}).`);
    }

    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isRecord(parsed)) return [parsed as MiniMaxMusicResponse];
    } catch {
      // Streaming responses use one JSON object per data event.
    }

    const payloads: MiniMaxMusicResponse[] = [];
    for (const line of trimmed.split(/\r?\n/)) {
      let data = line.trim();
      if (data.length === 0 || data.startsWith('event:') || data.startsWith(':')) continue;
      if (data.startsWith('data:')) data = data.slice('data:'.length).trim();
      if (data === '[DONE]') continue;

      try {
        const parsed: unknown = JSON.parse(data);
        if (isRecord(parsed)) payloads.push(parsed as MiniMaxMusicResponse);
      } catch {
        // Ignore framing lines, but reject a response with no JSON payloads below.
      }
    }

    if (payloads.length === 0) {
      throw new Error(
        responseOk
          ? 'MiniMax music generation returned an invalid response.'
          : `MiniMax music generation returned an invalid error response (HTTP ${status}).`
      );
    }
    return payloads;
  }

  private formatHttpError(status: number, payloads: MiniMaxMusicResponse[]): string {
    const message = [...payloads].reverse().find((payload) => payload.base_resp?.status_msg)
      ?.base_resp?.status_msg;
    return `MiniMax music generation request failed with HTTP ${status}: ${message ?? 'request rejected'}`;
  }

  private toPayload(
    request: MiniMaxMusicRequest,
    region: MiniMaxMusicRegion
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = { model: request.model };
    const optionalFields = [
      'prompt',
      'lyrics',
      'stream',
      'output_format',
      'audio_setting',
      'lyrics_optimizer',
      'is_instrumental',
    ] as const;

    for (const field of optionalFields) {
      if (request[field] !== undefined) payload[field] = request[field];
    }
    if (region === 'cn_zh' && request.aigc_watermark !== undefined) {
      payload.aigc_watermark = request.aigc_watermark;
    }
    return payload;
  }

  private validateRequest(request: MiniMaxMusicRequest): void {
    if (!isRecord(request)) throw new Error('Music generation request must be an object.');
    if (!isOneOf(request.model, MINIMAX_MUSIC_MODELS)) {
      throw new Error(`Invalid music generation model: ${String(request.model)}.`);
    }
    if (
      request.region !== undefined &&
      !isOneOf(request.region, Object.keys(MINIMAX_MUSIC_ENDPOINTS))
    ) {
      throw new Error(`Invalid music generation region: ${String(request.region)}.`);
    }
    if (request.prompt !== undefined && typeof request.prompt !== 'string') {
      throw new Error('Music generation prompt must be a string.');
    }
    if (request.lyrics !== undefined && typeof request.lyrics !== 'string') {
      throw new Error('Music generation lyrics must be a string.');
    }
    if (request.stream !== undefined && typeof request.stream !== 'boolean') {
      throw new Error('Music generation stream must be a boolean.');
    }
    if (
      request.output_format !== undefined &&
      !isOneOf(request.output_format, MINIMAX_MUSIC_OUTPUT_FORMATS)
    ) {
      throw new Error(`Invalid music generation output format: ${String(request.output_format)}.`);
    }
    if (request.stream === true && request.output_format === 'url') {
      throw new Error('Streaming music generation only supports hexadecimal output.');
    }
    if (request.audio_setting !== undefined) {
      if (!isRecord(request.audio_setting))
        throw new Error('Music generation audio_setting must be an object.');
      const format = request.audio_setting.format;
      if (format !== undefined && !isOneOf(format, MINIMAX_MUSIC_AUDIO_FORMATS)) {
        throw new Error(`Invalid music generation audio format: ${String(format)}.`);
      }
      for (const field of ['sample_rate', 'bitrate', 'channel'] as const) {
        const value = request.audio_setting[field];
        if (
          value !== undefined &&
          (typeof value !== 'number' || !Number.isInteger(value) || value <= 0)
        ) {
          throw new Error(`Music generation audio_setting.${field} must be a positive integer.`);
        }
      }
    }
    for (const field of ['lyrics_optimizer', 'is_instrumental', 'aigc_watermark'] as const) {
      const value = request[field];
      if (value !== undefined && typeof value !== 'boolean') {
        throw new Error(`Music generation ${field} must be a boolean.`);
      }
    }
    if (request.aigc_watermark !== undefined && request.region !== 'cn_zh') {
      throw new Error('aigc_watermark is only supported for the China music endpoint.');
    }
  }
}

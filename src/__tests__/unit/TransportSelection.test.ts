/**
 * Transport selection (#252 review finding).
 *
 * Being on PATH is not the same as being usable. `KNOWN_CLIS` is ordered
 * claude, agy, codex — so an installed-but-unauthenticated `claude` would
 * win, and every request would fail without `agy` ever being tried. That
 * is exactly the machine #252 exists to serve: one where `agy` holds
 * valid credentials this service's ladder cannot see.
 */

import { AiAuthError } from '../../services/ai/AiTransport.js';
import type { AiTransportEntry } from '../../services/ai/AiTransport.js';

jest.mock('../../services/ai/CliTransport.js', () => ({
  cliTransports: jest.fn(),
  hasCliTransport: jest.fn(() => true),
}));

import { cliTransports } from '../../services/ai/CliTransport.js';
import { GeminiService } from '../../services/GeminiService.js';

function transport(id: string, opts: { installed?: boolean; authed?: boolean } = {}): AiTransportEntry {
  const installed = opts.installed ?? true;
  const authed = opts.authed ?? true;
  return {
    id, label: id,
    isAvailable: jest.fn(async () => installed),
    send: jest.fn(async () => {
      if (!authed) throw new AiAuthError(`${id} is not authenticated`);
      return 'OK';
    }),
  };
}

describe('transport selection', () => {
  beforeEach(() => { jest.clearAllMocks(); delete process.env.GEMINI_API_KEY; });

  it('falls through an installed but unauthenticated CLI to a working one', async () => {
    const broken = transport('cli:claude', { authed: false });
    const working = transport('cli:agy');
    (cliTransports as jest.Mock).mockReturnValue([broken, working]);

    expect(await new GeminiService().getTransportId()).toBe('cli:agy');
  });

  it('skips a CLI that is not installed without probing it', async () => {
    const absent = transport('cli:claude', { installed: false });
    const working = transport('cli:agy');
    (cliTransports as jest.Mock).mockReturnValue([absent, working]);

    await new GeminiService().getTransportId();

    expect(absent.send).not.toHaveBeenCalled();
  });

  it('reports none available when every CLI fails to authenticate', async () => {
    (cliTransports as jest.Mock).mockReturnValue([
      transport('cli:claude', { authed: false }),
      transport('cli:agy', { authed: false }),
    ]);

    expect(await new GeminiService().getTransportId()).toBeNull();
  });

  it('prefers the first working candidate, in preference order', async () => {
    const first = transport('cli:claude');
    const second = transport('cli:agy');
    (cliTransports as jest.Mock).mockReturnValue([first, second]);

    expect(await new GeminiService().getTransportId()).toBe('cli:claude');
    expect(second.send).not.toHaveBeenCalled();
  });

  it('probes only once, then reuses the resolved transport', async () => {
    const only = transport('cli:agy');
    (cliTransports as jest.Mock).mockReturnValue([only]);
    const service = new GeminiService();

    await service.getTransportId();
    await service.getTransportId();

    expect(only.send).toHaveBeenCalledTimes(1);
  });

  /**
   * A long-lived server that starts with no credentials could otherwise
   * never recover: the null result was cached and logging into a CLI
   * afterwards would require a restart.
   */
  it('can re-probe after credentials appear', async () => {
    (cliTransports as jest.Mock).mockReturnValue([transport('cli:agy', { authed: false })]);
    const service = new GeminiService();
    expect(await service.getTransportId()).toBeNull();

    (cliTransports as jest.Mock).mockReturnValue([transport('cli:agy')]);
    service.resetTransport();

    expect(await service.getTransportId()).toBe('cli:agy');
  });

  it('honours enableCliTransport: false', async () => {
    const working = transport('cli:agy');
    (cliTransports as jest.Mock).mockReturnValue([working]);

    const service = new GeminiService({ enableCliTransport: false });

    expect(await service.getTransportId()).toBeNull();
    expect(working.send).not.toHaveBeenCalled();
  });
});

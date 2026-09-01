/**
 * Three verified findings from a cross-model review of StrudelController
 * (#488). Each was reproduced before it was acted on.
 */
import { StrudelController } from '../../StrudelController';

type Ctl = StrudelController & {
  _page: unknown;
  browser: unknown;
  getCurrentPattern(): Promise<string>;
  writePattern(p: string): Promise<string>;
};

describe('replaceInPattern replaces literally', () => {
  const withPattern = (current: string): { ctl: Ctl; written: string[] } => {
    const written: string[] = [];
    const ctl = new StrudelController() as Ctl;
    ctl._page = {};
    ctl.getCurrentPattern = () => Promise.resolve(current);
    ctl.writePattern = (p: string) => { written.push(p); return Promise.resolve('ok'); };
    return { ctl, written };
  };

  it.each([
    ['$& (the whole match)', '$&x', 'bdx sd', '$&x sd'],
    ['$` (text before)', 'a$`b', 'ab sd', 'a$`b sd'],
    ['$$ (an escaped dollar)', 'x$$y', 'x$y sd', 'x$$y sd'],
  ])('does not interpret %s', async (_label, replacement, wrongly, expected) => {
    // The search was escaped and the replacement was not, so
    // String.replace interpreted its special patterns. The comment
    // above the escape called it "prevent injection", which was
    // exactly half the job.
    const { ctl, written } = withPattern('bd sd');
    await ctl.replaceInPattern('bd', replacement);
    expect(written[0]).toBe(expected);
    expect(written[0]).not.toBe(wrongly);
  });

  it('still replaces ordinary text, and every occurrence', async () => {
    const { ctl, written } = withPattern('bd sd bd');
    await ctl.replaceInPattern('bd', 'cp');
    expect(written[0]).toBe('cp sd cp');
  });

  it('still treats the search as literal, not as a regex', async () => {
    const { ctl, written } = withPattern('s("bd*4")');
    await ctl.replaceInPattern('bd*4', 'sd*2');
    expect(written[0]).toBe('s("sd*2")');
  });

  it('reports no match without writing', async () => {
    const { ctl, written } = withPattern('bd sd');
    expect(await ctl.replaceInPattern('zz', 'cp')).toMatch(/No matches/);
    expect(written).toEqual([]);
  });
});

describe('diagnostics reports connectivity, not existence', () => {
  it('calls a closed page unloaded and a disconnected browser disconnected', async () => {
    const ctl = new StrudelController() as Ctl;
    ctl.browser = { isConnected: () => false };
    ctl._page = { isClosed: () => true };

    const diagnostics = await ctl.getDiagnostics();
    // These were `!== null`, so closing the browser out from under the
    // controller left the state-reporting tool reporting health.
    expect(diagnostics.browserConnected).toBe(false);
    expect(diagnostics.pageLoaded).toBe(false);
  });

  it('reports a live browser and open page as such', async () => {
    const ctl = new StrudelController() as Ctl;
    ctl.browser = { isConnected: () => true };
    ctl._page = { isClosed: () => false };

    const diagnostics = await ctl.getDiagnostics();
    expect(diagnostics.browserConnected).toBe(true);
    expect(diagnostics.pageLoaded).toBe(true);
  });

  it('reports nothing connected before init', async () => {
    const diagnostics = await new StrudelController().getDiagnostics();
    expect(diagnostics.browserConnected).toBe(false);
    expect(diagnostics.pageLoaded).toBe(false);
  });
});

describe('console monitoring installs one listener per page', () => {
  it('does not attach twice to the same page', () => {
    // `page.on` appends. Nothing removed the previous listener, so a
    // second call recorded every message twice and doubled the error
    // count diagnostics reports.
    const events: string[] = [];
    const page = { on: (event: string, _fn: unknown) => events.push(event) };
    const ctl = new StrudelController() as Ctl;
    ctl._page = page;

    ctl.setupConsoleMonitoring();
    const afterFirst = [...events];
    ctl.setupConsoleMonitoring();
    ctl.setupConsoleMonitoring();

    // One registration per event type, however many times it is called.
    expect(events).toEqual(afterFirst);
    expect(new Set(events).size).toBe(afterFirst.length);
  });

  it('attaches again for a different page', () => {
    const ctl = new StrudelController() as Ctl;
    const first: string[] = [];
    const second: string[] = [];
    ctl._page = { on: (e: string, _fn: unknown) => first.push(e) };
    ctl.setupConsoleMonitoring();
    ctl._page = { on: (e: string, _fn: unknown) => second.push(e) };
    ctl.setupConsoleMonitoring();

    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
  });
});

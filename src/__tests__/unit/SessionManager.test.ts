import { SessionManager } from '../../services/SessionManager';
import { StrudelController } from '../../StrudelController';
import { chromium } from 'playwright';
import { MockBrowser, MockPage, MockBrowserContext } from '../utils/MockPlaywright';

// Mock Playwright
jest.mock('playwright', () => ({
  chromium: {
    launch: jest.fn(),
  },
}));

describe('SessionManager', () => {
  let sessionManager: SessionManager;
  let mockBrowser: MockBrowser;
  let mockPage: MockPage;
  let mockContext: MockBrowserContext;

  beforeEach(() => {
    mockPage = new MockPage();
    mockContext = new MockBrowserContext();
    mockBrowser = new MockBrowser();

    // Set up the mock chain: browser -> context -> page
    mockContext.newPage = jest.fn().mockResolvedValue(mockPage);
    mockBrowser.newContext = jest.fn().mockResolvedValue(mockContext);
    (chromium.launch as jest.Mock).mockResolvedValue(mockBrowser);

    sessionManager = new SessionManager(true);
  });

  afterEach(async () => {
    await sessionManager.destroyAll();
    jest.clearAllMocks();
  });

  describe('session creation', () => {
    test('should create a new session', async () => {
      const controller = await sessionManager.createSession('test-session');

      expect(controller).toBeDefined();
      expect(controller).toBeInstanceOf(StrudelController);
      expect(sessionManager.listSessions()).toContain('test-session');
    });

    test('should create default session', async () => {
      const controller = await sessionManager.createSession('default');

      expect(controller).toBeDefined();
      expect(sessionManager.getDefaultSession()).toBe(controller);
    });

    test('should launch browser on first session creation', async () => {
      await sessionManager.createSession('first');

      expect(chromium.launch).toHaveBeenCalledTimes(1);
      expect(chromium.launch).toHaveBeenCalledWith(
        expect.objectContaining({
          headless: true,
        })
      );
    });

    test('should reuse browser for subsequent sessions', async () => {
      await sessionManager.createSession('session1');
      await sessionManager.createSession('session2');

      expect(chromium.launch).toHaveBeenCalledTimes(1);
    });

    test('should create isolated context for each session', async () => {
      await sessionManager.createSession('session1');
      await sessionManager.createSession('session2');

      expect(mockBrowser.newContext).toHaveBeenCalledTimes(2);
    });

    test('pins the default viewport on new contexts (#514)', async () => {
      await sessionManager.createSession('vp-default');

      expect(mockBrowser.newContext).toHaveBeenCalledWith(
        expect.objectContaining({ viewport: { width: 1280, height: 720 } }),
      );
    });

    test('a null viewport reaches newContext so resizes reach the page (#514)', async () => {
      const loose = new SessionManager(true, undefined, undefined, { viewport: null });

      await loose.createSession('vp-null');

      expect(mockBrowser.newContext).toHaveBeenCalledWith(
        expect.objectContaining({ viewport: null }),
      );
      await loose.destroyAll();
    });

    test('should throw error for duplicate session ID', async () => {
      await sessionManager.createSession('duplicate');

      await expect(sessionManager.createSession('duplicate')).rejects.toThrow(
        "Session 'duplicate' already exists"
      );
    });

    test('should throw error for empty session ID', async () => {
      await expect(sessionManager.createSession('')).rejects.toThrow(
        'Session ID must be a non-empty string'
      );
    });

    test('should throw error when max sessions reached', async () => {
      // Create max sessions
      for (let i = 0; i < sessionManager.getMaxSessions(); i++) {
        await sessionManager.createSession(`session-${i}`);
      }

      await expect(sessionManager.createSession('one-too-many')).rejects.toThrow(
        /Maximum session limit/
      );
    });
  });

  describe('session retrieval', () => {
    test('should get existing session by ID', async () => {
      const created = await sessionManager.createSession('test');
      const retrieved = sessionManager.getSession('test');

      expect(retrieved).toBe(created);
    });

    test('should return undefined for non-existent session', () => {
      const result = sessionManager.getSession('non-existent');

      expect(result).toBeUndefined();
    });

    test('should update lastActivity on getSession', async () => {
      await sessionManager.createSession('test');

      const infoBefore = sessionManager.getSessionsInfo()[0];
      const lastActivityBefore = infoBefore.lastActivity;

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 10));

      sessionManager.getSession('test');
      const infoAfter = sessionManager.getSessionsInfo()[0];

      expect(infoAfter.lastActivity.getTime()).toBeGreaterThan(
        lastActivityBefore.getTime()
      );
    });
  });

  describe('default session', () => {
    test('should return undefined when no default session exists', () => {
      expect(sessionManager.getDefaultSession()).toBeUndefined();
    });

    test('should get default session after creation', async () => {
      const controller = await sessionManager.createSession('default');

      expect(sessionManager.getDefaultSession()).toBe(controller);
    });

    test('should switch default session', async () => {
      await sessionManager.createSession('session1');
      const session2 = await sessionManager.createSession('session2');

      sessionManager.setDefaultSession('session2');

      expect(sessionManager.getDefaultSession()).toBe(session2);
      expect(sessionManager.getDefaultSessionId()).toBe('session2');
    });

    test('should throw error when setting non-existent session as default', () => {
      expect(() => sessionManager.setDefaultSession('non-existent')).toThrow(
        "Session 'non-existent' not found"
      );
    });
  });

  describe('session destruction', () => {
    test('should destroy session', async () => {
      await sessionManager.createSession('to-destroy');

      await sessionManager.destroySession('to-destroy');

      expect(sessionManager.listSessions()).not.toContain('to-destroy');
      expect(sessionManager.getSession('to-destroy')).toBeUndefined();
    });

    test('should throw error when destroying non-existent session', async () => {
      await expect(sessionManager.destroySession('non-existent')).rejects.toThrow(
        "Session 'non-existent' not found"
      );
    });

    test('should close browser when last session destroyed', async () => {
      await sessionManager.createSession('only-session');
      const closeSpy = jest.spyOn(mockBrowser, 'close');

      await sessionManager.destroySession('only-session');

      expect(closeSpy).toHaveBeenCalled();
    });

    test('should not close browser when other sessions exist', async () => {
      await sessionManager.createSession('session1');
      await sessionManager.createSession('session2');
      const closeSpy = jest.spyOn(mockBrowser, 'close');

      await sessionManager.destroySession('session1');

      expect(closeSpy).not.toHaveBeenCalled();
    });

    test('should reset default session when destroyed', async () => {
      await sessionManager.createSession('my-default');
      sessionManager.setDefaultSession('my-default');

      await sessionManager.destroySession('my-default');

      expect(sessionManager.getDefaultSessionId()).toBe('default');
    });
  });

  describe('destroyAll', () => {
    test('should destroy all sessions', async () => {
      await sessionManager.createSession('session1');
      await sessionManager.createSession('session2');
      await sessionManager.createSession('session3');

      await sessionManager.destroyAll();

      expect(sessionManager.listSessions()).toHaveLength(0);
      expect(sessionManager.getSessionCount()).toBe(0);
    });

    test('should close browser after destroying all sessions', async () => {
      await sessionManager.createSession('session1');
      const closeSpy = jest.spyOn(mockBrowser, 'close');

      await sessionManager.destroyAll();

      expect(closeSpy).toHaveBeenCalled();
    });

    test('should handle destroyAll with no sessions', async () => {
      await expect(sessionManager.destroyAll()).resolves.not.toThrow();
    });
  });

  describe('listSessions', () => {
    test('should return empty array when no sessions', () => {
      expect(sessionManager.listSessions()).toEqual([]);
    });

    test('should return all session IDs', async () => {
      await sessionManager.createSession('alpha');
      await sessionManager.createSession('beta');
      await sessionManager.createSession('gamma');

      const sessions = sessionManager.listSessions();

      expect(sessions).toHaveLength(3);
      expect(sessions).toContain('alpha');
      expect(sessions).toContain('beta');
      expect(sessions).toContain('gamma');
    });
  });

  describe('getSessionsInfo', () => {
    test('should return empty array when no sessions', () => {
      expect(sessionManager.getSessionsInfo()).toEqual([]);
    });

    test('should return session info with metadata', async () => {
      await sessionManager.createSession('test-session');

      const info = sessionManager.getSessionsInfo();

      expect(info).toHaveLength(1);
      expect(info[0].id).toBe('test-session');
      expect(info[0].created).toBeInstanceOf(Date);
      expect(info[0].lastActivity).toBeInstanceOf(Date);
      expect(typeof info[0].isPlaying).toBe('boolean');
    });
  });

  describe('session isolation', () => {
    test('should maintain separate controllers per session', async () => {
      const controller1 = await sessionManager.createSession('session1');
      const controller2 = await sessionManager.createSession('session2');

      expect(controller1).not.toBe(controller2);
    });

    test('should create separate contexts for each session', async () => {
      await sessionManager.createSession('session1');
      await sessionManager.createSession('session2');

      // Each session should have its own context
      expect(mockBrowser.newContext).toHaveBeenCalledTimes(2);
    });
  });

  describe('resource management', () => {
    test('should track session count', async () => {
      expect(sessionManager.getSessionCount()).toBe(0);

      await sessionManager.createSession('session1');
      expect(sessionManager.getSessionCount()).toBe(1);

      await sessionManager.createSession('session2');
      expect(sessionManager.getSessionCount()).toBe(2);

      await sessionManager.destroySession('session1');
      expect(sessionManager.getSessionCount()).toBe(1);
    });

    test('should report browser running state', async () => {
      expect(sessionManager.isBrowserRunning()).toBe(false);

      await sessionManager.createSession('test');
      expect(sessionManager.isBrowserRunning()).toBe(true);

      await sessionManager.destroyAll();
      expect(sessionManager.isBrowserRunning()).toBe(false);
    });

    test('should return max sessions constant', () => {
      expect(sessionManager.getMaxSessions()).toBe(5);
    });
  });

  describe('constructor options', () => {
    test('should default to headless false', async () => {
      const nonHeadlessManager = new SessionManager(false);
      await nonHeadlessManager.createSession('test');

      expect(chromium.launch).toHaveBeenCalledWith(
        expect.objectContaining({
          headless: false,
        })
      );

      await nonHeadlessManager.destroyAll();
    });

    test('should use headless true when specified', async () => {
      const headlessManager = new SessionManager(true);
      await headlessManager.createSession('test');

      expect(chromium.launch).toHaveBeenCalledWith(
        expect.objectContaining({
          headless: true,
        })
      );

      await headlessManager.destroyAll();
    });
  });

  describe('error handling', () => {
    test('should handle context close errors gracefully', async () => {
      await sessionManager.createSession('test');

      // Make context.close throw an error
      const session = (sessionManager as any).sessions.get('test');
      session.context.close = jest.fn().mockRejectedValue(new Error('Close failed'));

      // Should not throw
      await expect(sessionManager.destroySession('test')).resolves.not.toThrow();
    });

    test('should handle browser close errors gracefully', async () => {
      await sessionManager.createSession('test');

      mockBrowser.close = jest.fn().mockRejectedValue(new Error('Browser close failed'));

      // Should not throw
      await expect(sessionManager.destroyAll()).resolves.not.toThrow();
    });
  });

  describe('backwards compatibility', () => {
    test('should work with single default session pattern', async () => {
      // Simulate old usage pattern: create default session, use it
      const controller = await sessionManager.createSession('default');

      expect(sessionManager.getDefaultSession()).toBe(controller);
      expect(sessionManager.getSession('default')).toBe(controller);
    });

    test('should allow multiple sessions after default', async () => {
      await sessionManager.createSession('default');
      await sessionManager.createSession('secondary');

      expect(sessionManager.listSessions()).toHaveLength(2);
    });
  });
});

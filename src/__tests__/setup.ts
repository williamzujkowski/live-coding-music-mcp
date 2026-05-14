// Global test setup and configuration

// Increase timeout for integration tests
jest.setTimeout(10000);

// Mock console methods to reduce noise in test output
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Setup global test utilities
beforeAll(() => {
  // Any global setup
});

afterAll(() => {
  // Any global cleanup
});

// Add custom matchers if needed
expect.extend({
  toBeValidStrudelPattern(received: string) {
    const pass = received.includes('s(') || received.includes('note(') || received.includes('stack(');
    return {
      pass,
      message: () => `Expected ${received} to be a valid Strudel pattern`
    };
  }
});

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    interface Matchers<R> {
      toBeValidStrudelPattern(): R;
    }
  }
}

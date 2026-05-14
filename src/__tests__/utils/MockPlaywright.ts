import { Page, Browser, BrowserContext } from 'playwright';

export class MockPage implements Partial<Page> {
  private content: string = '';
  private isPlayingState: boolean = false;
  private evaluateHandlers: Map<string, Function> = new Map();
  private url: string = '';
  private eventHandlers: Map<string, Function[]> = new Map();

  on(event: string, handler: Function): this {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event)!.push(handler);
    return this;
  }

  off(event: string, handler?: Function): this {
    if (!handler) {
      this.eventHandlers.delete(event);
    } else {
      const handlers = this.eventHandlers.get(event);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index !== -1) {
          handlers.splice(index, 1);
        }
      }
    }
    return this;
  }

  async goto(url: string, _options?: any): Promise<any> {
    this.url = url;
    return {};
  }

  async waitForSelector(_selector: string, _options?: any): Promise<any> {
    return {};
  }

  async waitForTimeout(timeout: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, Math.min(timeout, 10)));
  }

  async waitForFunction(_fn: Function, _options?: any): Promise<any> {
    // Mock always succeeds - simulates CodeMirror being ready
    return {};
  }

  async click(selector: string, _options?: any): Promise<void> {
    if (selector.includes('play')) {
      this.isPlayingState = true;
    } else if (selector.includes('stop')) {
      this.isPlayingState = false;
    }
  }

  async type(text: string, _options?: any): Promise<void> {
    this.content += text;
  }

  async route(_url: string, _handler: Function): Promise<void> {
    // Mock route interception
  }

  keyboard = {
    press: async (key: string): Promise<void> => {
      if (key.includes('Enter')) {
        this.isPlayingState = true;
      } else if (key.includes('Period')) {
        this.isPlayingState = false;
      } else if (key.includes('A')) {
        this.content = '';
      }
    },
    type: async (text: string): Promise<void> => {
      this.content += text;
    }
  };

  async evaluate(fn: Function, ...args: any[]): Promise<any> {
    // Simulate common evaluate calls
    const fnString = fn.toString();

    if (fnString.includes('strudelAudioAnalyzer')) {
      if (fnString.includes('connect()')) {
        return undefined;
      }
      if (fnString.includes('analyze()')) {
        // Return different values based on playing state
        if (this.isPlayingState) {
          return {
            connected: true,
            timestamp: Date.now(),
            features: {
              average: 50,
              peak: 100,
              peakFrequency: 440,
              centroid: 250,
              bass: 60,
              lowMid: 50,
              mid: 40,
              highMid: 30,
              treble: 20,
              isPlaying: true,
              isSilent: false,
              bassToTrebleRatio: '3.00',
              brightness: 'balanced'
            }
          };
        } else {
          // Silent state
          return {
            connected: true,
            timestamp: Date.now(),
            features: {
              average: 0,
              peak: 0,
              peakFrequency: 0,
              centroid: 0,
              bass: 0,
              lowMid: 0,
              mid: 0,
              highMid: 0,
              treble: 0,
              isPlaying: false,
              isSilent: true,
              bassToTrebleRatio: 'N/A',
              brightness: 'dark'
            }
          };
        }
      }
    }

    // Handle strudelMirror API (the correct API for strudel.cc)
    if (fnString.includes('strudelMirror')) {
      // Handle reading via sm.code or sm.editor.state.doc
      if (fnString.includes('sm?.code') || fnString.includes('sm.code') ||
          fnString.includes('editor?.state?.doc') || fnString.includes('editor.state.doc')) {
        return this.content;
      }
      // Handle writing via editor.dispatch
      if (fnString.includes('dispatch')) {
        const newContent = args[0];
        if (typeof newContent === 'string') {
          this.content = newContent;
        }
        return true; // Return success indicator
      }
      // Handle diagnostics check for editor API
      if (fnString.includes('editor?.dispatch') || fnString.includes('editor.dispatch')) {
        return true; // Editor is ready
      }
    }

    if (fnString.includes('.cm-content')) {
      // Handle reading with CodeMirror API (view.state.doc.toString())
      if (fnString.includes('view.state.doc.toString') || fnString.includes('doc.toString')) {
        return this.content;
      }
      // Legacy textContent support
      if (fnString.includes('textContent')) {
        return this.content;
      }
      // Handle writing with CodeMirror dispatch
      if (fnString.includes('dispatch')) {
        const newContent = args[0];
        if (typeof newContent === 'string') {
          this.content = newContent;
        }
        return true; // Return success indicator
      }
      // Handle querySelector returning element
      if (fnString.includes('querySelector')) {
        return true; // Element exists
      }
    }

    // Allow custom handlers
    for (const [key, handler] of this.evaluateHandlers.entries()) {
      if (fnString.includes(key)) {
        return handler(...args);
      }
    }

    return undefined;
  }

  setEvaluateHandler(key: string, handler: Function): void {
    this.evaluateHandlers.set(key, handler);
  }

  getContent(): string {
    return this.content;
  }

  setContent(content: string): void {
    this.content = content;
  }

  isPlaying(): boolean {
    return this.isPlayingState;
  }
}

export class MockBrowserContext implements Partial<BrowserContext> {
  async newPage(): Promise<any> {
    return new MockPage();
  }
}

export class MockBrowser implements Partial<Browser> {
  private closed: boolean = false;

  async newContext(_options?: any): Promise<any> {
    return new MockBrowserContext();
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  isClosed(): boolean {
    return this.closed;
  }
}

export const createMockBrowser = (): MockBrowser => {
  return new MockBrowser();
};

export const createMockPage = (): MockPage => {
  return new MockPage();
};

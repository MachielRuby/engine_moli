import { createHttpMatcher } from './http-matcher.js';
import { createMockMatcher } from './mock-matcher.js';

export function createMatcher(options = {}) {
  const params = new URLSearchParams(window.location.search);
  const mode = options.mode || params.get('matcher') || 'mock';

  if (mode === 'http') {
    return createHttpMatcher({
      endpoint: options.endpoint || params.get('endpoint') || '/api/match-frame',
    });
  }

  return createMockMatcher({
    indexUrl: options.indexUrl || '/image-targets/index.json',
  });
}

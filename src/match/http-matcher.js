import { assertValidMatchResult } from './contract.js';

export function createHttpMatcher(options = {}) {
  const endpoint = options.endpoint || '/api/match-frame';

  return {
    mode: 'http',
    async init() {
      return { endpoint };
    },
    async matchFrame(frame) {
      const payload = new FormData();
      payload.append('frame', frame.blob, `capture-${frame.timestamp}.jpg`);
      payload.append('deviceWidth', String(frame.videoWidth));
      payload.append('deviceHeight', String(frame.videoHeight));
      payload.append('viewportWidth', String(frame.viewportWidth));
      payload.append('viewportHeight', String(frame.viewportHeight));
      payload.append('timestamp', String(frame.timestamp));

      const response = await fetch(endpoint, {
        method: 'POST',
        body: payload,
      });

      if (!response.ok) {
        throw new Error(`Matcher request failed: ${response.status}`);
      }

      return assertValidMatchResult(await response.json());
    },
  };
}

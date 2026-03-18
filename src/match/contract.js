const REQUIRED_CORNER_COUNT = 4;

export function createNoMatchResult(extra = {}) {
  return {
    matched: false,
    targetId: null,
    targetName: null,
    score: 0,
    modelUrl: null,
    corners: [],
    pose: null,
    debug: {},
    ...extra,
  };
}

export function normalizeMatchResult(input) {
  const base = createNoMatchResult();
  const result = { ...base, ...(input || {}) };

  result.score = clampScore(result.score);
  result.corners = Array.isArray(result.corners)
    ? result.corners
        .slice(0, REQUIRED_CORNER_COUNT)
        .map((corner) => ({
          x: Number(corner?.x ?? 0),
          y: Number(corner?.y ?? 0),
        }))
    : [];

  if (!result.matched || !result.targetId || !result.modelUrl || result.corners.length !== REQUIRED_CORNER_COUNT) {
    return createNoMatchResult({
      score: result.score,
      debug: result.debug || {},
    });
  }

  result.targetId = String(result.targetId);
  result.targetName = result.targetName ? String(result.targetName) : result.targetId;
  result.modelUrl = String(result.modelUrl);
  result.debug = result.debug || {};
  return result;
}

export function assertValidMatchResult(input) {
  return normalizeMatchResult(input);
}

function clampScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) {
    return 0;
  }

  if (score < 0) {
    return 0;
  }

  if (score > 1) {
    return 1;
  }

  return score;
}

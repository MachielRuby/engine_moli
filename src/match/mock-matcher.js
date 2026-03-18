import { assertValidMatchResult, createNoMatchResult } from './contract.js';
import { fetchTargetLibrary, loadImage } from './target-library.js';

const DESCRIPTOR_WIDTH = 32;
const DESCRIPTOR_HEIGHT = 32;
const SEARCH_SCALES = [0.22, 0.3, 0.4, 0.52, 0.64, 0.76, 0.9];
const SEARCH_GRID = [-1, -0.5, 0, 0.5, 1];
const MIN_EDGE_DENSITY = 0.03;

export function createMockMatcher(options = {}) {
  const indexUrl = options.indexUrl || '/image-targets/index.json';
  const descriptorCanvas = document.createElement('canvas');
  const descriptorContext = descriptorCanvas.getContext('2d', { willReadFrequently: true });
  let library = [];

  return {
    mode: 'mock',

    async init() {
      const targets = await fetchTargetLibrary(indexUrl);
      library = await Promise.all(
        targets.map(async (target) => {
          const image = await loadImage(target.matchImageUrl);
          return {
            ...target,
            aspectRatio: target.referenceWidth / target.referenceHeight,
            descriptor: extractDescriptor(image, {
              sx: 0,
              sy: 0,
              sw: image.naturalWidth,
              sh: image.naturalHeight,
            }),
          };
        }),
      );

      return {
        mode: 'mock',
        targetCount: library.length,
      };
    },

    async matchFrame(frame) {
      if (!library.length) {
        await this.init();
      }

      const startedAt = performance.now();
      const best = findBestMatch(frame.canvas, library, descriptorCanvas, descriptorContext);
      const latencyMs = Math.round(performance.now() - startedAt);
      const candidateCount = library.length * SEARCH_SCALES.length * SEARCH_GRID.length * SEARCH_GRID.length;

      if (
        !best ||
        best.score < best.target.threshold ||
        best.structureScore < best.target.minStructureScore ||
        best.gap < best.target.minGap
      ) {
        return createNoMatchResult({
          score: best ? best.score : 0,
          debug: {
            latencyMs,
            candidateCount,
            matcherMode: 'mock',
            gap: best?.gap || 0,
            structureScore: best?.structureScore || 0,
            secondScore: best?.secondScore || 0,
          },
        });
      }

      return assertValidMatchResult({
        matched: true,
        targetId: best.target.id,
        targetName: best.target.displayName,
        score: best.score,
        modelUrl: best.target.modelUrl,
        corners: cropToCorners(best.crop),
        pose: null,
        debug: {
          latencyMs,
          candidateCount,
          threshold: best.target.threshold,
          matcherMode: 'mock',
          gap: best.gap,
          structureScore: best.structureScore,
          secondScore: best.secondScore,
        },
      });
    },
  };

  function extractDescriptor(source, crop) {
    descriptorCanvas.width = DESCRIPTOR_WIDTH;
    descriptorCanvas.height = DESCRIPTOR_HEIGHT;
    descriptorContext.clearRect(0, 0, DESCRIPTOR_WIDTH, DESCRIPTOR_HEIGHT);
    descriptorContext.drawImage(source, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, DESCRIPTOR_WIDTH, DESCRIPTOR_HEIGHT);

    const pixels = descriptorContext.getImageData(0, 0, DESCRIPTOR_WIDTH, DESCRIPTOR_HEIGHT).data;
    return buildDescriptorFromPixels(pixels);
  }
}

function findBestMatch(sourceCanvas, library, descriptorCanvas, descriptorContext) {
  const frameWidth = sourceCanvas.width;
  const frameHeight = sourceCanvas.height;
  let best = null;
  let secondBest = null;

  library.forEach((target) => {
    const candidates = buildCandidates(frameWidth, frameHeight, target.aspectRatio);

    candidates.forEach((candidate) => {
      const descriptor = extractCanvasDescriptor(sourceCanvas, candidate, descriptorCanvas, descriptorContext);
      if (descriptor.edgeDensity < MIN_EDGE_DENSITY) {
        return;
      }

      const scoreInfo = compareDescriptors(descriptor, target.descriptor);
      const score = scoreInfo.totalScore;

      if (!best || score > best.score) {
        secondBest = best;
        best = {
          target,
          crop: candidate,
          score,
          structureScore: scoreInfo.structureScore,
          secondScore: secondBest ? secondBest.score : 0,
        };
      } else if (!secondBest || score > secondBest.score) {
        secondBest = {
          target,
          crop: candidate,
          score,
          structureScore: scoreInfo.structureScore,
        };
      }
    });
  });

  if (best) {
    best.secondScore = secondBest ? secondBest.score : 0;
    best.gap = best.score - (secondBest ? secondBest.score : 0);
  }

  return best;
}

function buildCandidates(frameWidth, frameHeight, aspectRatio) {
  return SEARCH_SCALES.flatMap((scale) => {
    const maxWidth = frameWidth * scale;
    const maxHeight = frameHeight * scale;
    let cropWidth = maxWidth;
    let cropHeight = cropWidth / aspectRatio;

    if (cropHeight > maxHeight) {
      cropHeight = maxHeight;
      cropWidth = cropHeight * aspectRatio;
    }

    const xMargin = Math.max(0, frameWidth - cropWidth);
    const yMargin = Math.max(0, frameHeight - cropHeight);

    return SEARCH_GRID.flatMap((gridY) =>
      SEARCH_GRID.map((gridX) => ({
        sx: clamp(((gridX + 1) / 2) * xMargin, 0, frameWidth - cropWidth),
        sy: clamp(((gridY + 1) / 2) * yMargin, 0, frameHeight - cropHeight),
        sw: cropWidth,
        sh: cropHeight,
      })),
    );
  });
}

function extractCanvasDescriptor(sourceCanvas, crop, descriptorCanvas, descriptorContext) {
  descriptorCanvas.width = DESCRIPTOR_WIDTH;
  descriptorCanvas.height = DESCRIPTOR_HEIGHT;
  descriptorContext.clearRect(0, 0, DESCRIPTOR_WIDTH, DESCRIPTOR_HEIGHT);
  descriptorContext.drawImage(
    sourceCanvas,
    crop.sx,
    crop.sy,
    crop.sw,
    crop.sh,
    0,
    0,
    DESCRIPTOR_WIDTH,
    DESCRIPTOR_HEIGHT,
  );

  const pixels = descriptorContext.getImageData(0, 0, DESCRIPTOR_WIDTH, DESCRIPTOR_HEIGHT).data;
  return buildDescriptorFromPixels(pixels);
}

function buildDescriptorFromPixels(pixels) {
  const rawGray = new Float32Array(DESCRIPTOR_WIDTH * DESCRIPTOR_HEIGHT);
  const gray = new Float32Array(DESCRIPTOR_WIDTH * DESCRIPTOR_HEIGHT);
  const gradient = new Float32Array(DESCRIPTOR_WIDTH * DESCRIPTOR_HEIGHT);
  let mean = 0;

  for (let index = 0; index < rawGray.length; index += 1) {
    const pixelOffset = index * 4;
    const value =
      (pixels[pixelOffset] * 0.299 +
        pixels[pixelOffset + 1] * 0.587 +
        pixels[pixelOffset + 2] * 0.114) /
      255;
    rawGray[index] = value;
    mean += value;
  }

  mean /= rawGray.length;

  let variance = 0;
  let edgeSum = 0;

  for (let y = 0; y < DESCRIPTOR_HEIGHT; y += 1) {
    for (let x = 0; x < DESCRIPTOR_WIDTH; x += 1) {
      const index = y * DESCRIPTOR_WIDTH + x;
      const centered = rawGray[index] - mean;
      gray[index] = centered;
      variance += centered * centered;

      const left = rawGray[indexAt(x - 1, y)];
      const right = rawGray[indexAt(x + 1, y)];
      const top = rawGray[indexAt(x, y - 1)];
      const bottom = rawGray[indexAt(x, y + 1)];
      const magnitude = Math.hypot(right - left, bottom - top);
      gradient[index] = magnitude;
      edgeSum += magnitude;
    }
  }

  normalizeVector(gray, Math.sqrt(variance) || 1);

  let gradientNorm = 0;
  for (let index = 0; index < gradient.length; index += 1) {
    gradientNorm += gradient[index] * gradient[index];
  }
  normalizeVector(gradient, Math.sqrt(gradientNorm) || 1);

  return {
    gray,
    gradient,
    edgeDensity: edgeSum / gradient.length,
  };
}

function compareDescriptors(candidate, target) {
  const appearanceScore = Math.max(0, (cosineSimilarity(candidate.gray, target.gray) + 1) / 2);
  const structureScore = Math.max(0, (cosineSimilarity(candidate.gradient, target.gradient) + 1) / 2);
  const edgePenalty = 1 - Math.min(1, Math.abs(candidate.edgeDensity - target.edgeDensity) / 0.18);

  return {
    appearanceScore,
    structureScore,
    totalScore: appearanceScore * 0.32 + structureScore * 0.53 + edgePenalty * 0.15,
  };
}

function cosineSimilarity(left, right) {
  let dot = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
  }
  return dot;
}

function cropToCorners(crop) {
  return [
    { x: crop.sx, y: crop.sy },
    { x: crop.sx + crop.sw, y: crop.sy },
    { x: crop.sx + crop.sw, y: crop.sy + crop.sh },
    { x: crop.sx, y: crop.sy + crop.sh },
  ];
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeVector(vector, norm) {
  for (let index = 0; index < vector.length; index += 1) {
    vector[index] /= norm;
  }
}

function indexAt(x, y) {
  const safeX = clamp(x, 0, DESCRIPTOR_WIDTH - 1);
  const safeY = clamp(y, 0, DESCRIPTOR_HEIGHT - 1);
  return safeY * DESCRIPTOR_WIDTH + safeX;
}

export async function fetchTargetLibrary(indexUrl = '/image-targets/index.json') {
  const response = await fetch(indexUrl, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load target index: ${response.status}`);
  }

  const data = await response.json();
  const targets = Array.isArray(data.targets) ? data.targets : [];

  return Promise.all(
    targets.map(async (target) => {
      let metadata = null;

      if (target.metadataUrl) {
        try {
          const metaResponse = await fetch(target.metadataUrl, { cache: 'no-store' });
          if (metaResponse.ok) {
            metadata = await metaResponse.json();
          }
        } catch (error) {
          console.warn('[matcher] failed to load target metadata', target.id, error);
        }
      }

      const referenceWidth = Number(target.referenceSize?.width || metadata?.properties?.originalWidth || 1);
      const referenceHeight = Number(target.referenceSize?.height || metadata?.properties?.originalHeight || 1);

      return {
        id: String(target.id),
        name: String(target.name || target.id),
        displayName: String(target.displayName || target.name || target.id),
        matchImageUrl: target.matchImageUrl,
        metadataUrl: target.metadataUrl || null,
        modelUrl: target.modelUrl,
        threshold: Number(target.match?.threshold || 0.8),
        minGap: Number(target.match?.minGap || 0.08),
        minStructureScore: Number(target.match?.minStructureScore || 0.7),
        referenceWidth,
        referenceHeight,
        metadata,
      };
    }),
  );
}

export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    image.src = url;
  });
}

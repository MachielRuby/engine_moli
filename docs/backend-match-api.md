# Match Frame API

## Endpoint

- `POST /api/match-frame`
- Content type: `multipart/form-data`

## Request fields

- `frame`: image blob from the current camera frame
- `deviceWidth`: source camera width in pixels
- `deviceHeight`: source camera height in pixels
- `viewportWidth`: visible preview width in pixels
- `viewportHeight`: visible preview height in pixels
- `timestamp`: capture time in milliseconds

## Success response

```json
{
  "matched": true,
  "targetId": "02",
  "targetName": "02",
  "score": 0.91,
  "modelUrl": "/models/02.glb",
  "corners": [
    { "x": 320, "y": 180 },
    { "x": 640, "y": 200 },
    { "x": 620, "y": 860 },
    { "x": 300, "y": 840 }
  ],
  "pose": {
    "rotation": [0, 0, 0, 1],
    "translation": [0, 0, -0.8],
    "scale": 1
  },
  "debug": {
    "candidateCount": 84,
    "latencyMs": 112
  }
}
```

## No-match response

```json
{
  "matched": false,
  "targetId": null,
  "targetName": null,
  "score": 0.31,
  "modelUrl": null,
  "corners": [],
  "pose": null,
  "debug": {
    "candidateCount": 84,
    "latencyMs": 109
  }
}
```

## Field rules

- `matched` is the only hard gate for whether the frontend should render anything.
- `score` should be normalized to `0..1` so thresholds can be tuned on the frontend.
- `corners` are required when `matched=true`.
- `corners` use preview-space pixels relative to the submitted frame after the server-side resize/crop convention is applied.
- `modelUrl` must be resolvable by the frontend without extra lookups.
- `pose` is optional for now. The current frontend can render from `corners` alone.

## Notes for real backend

- The backend should keep target metadata and target feature descriptors in its own library instead of relying on frontend target lists.
- New targets should only require adding a source image, running feature extraction, and storing the resolved `modelUrl`.
- If the backend later returns a full homography matrix, it can be added under `debug` or as a new `homography` field without breaking the current frontend contract.

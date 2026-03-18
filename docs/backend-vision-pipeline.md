# Backend Vision Pipeline

## Goal

Accept a full camera frame, identify the best-matching target image from a growing library, and return enough geometry for the frontend to place a model on the detected planar target.

## Recommended pipeline

1. Build target library offline.
2. Extract local features from each target image.
3. Store descriptors, keypoints, target size, and model mapping.
4. On each request, extract features from the submitted frame.
5. Run coarse retrieval to reduce the candidate set.
6. Run descriptor matching for the top candidates.
7. Estimate homography with RANSAC.
8. Convert homography to four projected corners.
9. Return the best candidate only when it passes confidence and inlier thresholds.

## MVP algorithm

- Detector: ORB
- Descriptor matcher: BFMatcher with Hamming distance
- Geometric verification: `findHomography(..., RANSAC)`
- Acceptance checks:
  - minimum keypoint count
  - minimum good match count
  - minimum RANSAC inlier ratio
  - normalized score threshold

## Response generation

- `targetId` comes from the matched library record.
- `modelUrl` comes from the same record.
- `corners` come from projecting the four corners of the reference image through the solved homography.
- `pose` can be added later from `solvePnP` if camera intrinsics are available and stable.

## Scaling path

- Keep the current ORB + RANSAC path as the geometric verifier.
- Add a coarse retrieval stage when the library grows:
  - global embeddings for fast shortlist
  - local features for final verification
- Version target descriptors so the backend can rebuild the library without changing the frontend API.

## Frontend compatibility

- The current `moni.html` flow only requires `matched`, `targetId`, `modelUrl`, `score`, and `corners`.
- This lets the frontend work today with a mock matcher and later switch to the real backend without changing page logic.

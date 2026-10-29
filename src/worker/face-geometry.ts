/**
 * Pure measurements derived from Face Landmarker output (thesis 3.2.3).
 * Landmarks are normalised: x by the frame width, y by the frame height.
 */

export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Face bounding box in pixels, from the extent of the 478 landmarks. */
export function faceBox(landmarks: readonly Landmark[], width: number, height: number): Box {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of landmarks) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    x: minX * width,
    y: minY * height,
    width: (maxX - minX) * width,
    height: (maxY - minY) * height,
  };
}

/**
 * Head yaw and pitch, in degrees, from the 4×4 facial transformation matrix.
 *
 * MediaPipe fills `Matrix.data` with the raw Eigen buffer of the pose matrix
 * (`MatrixDataProtoFromMatrix` copies `matrix.data()` and leaves the layout
 * unset), so the data is COLUMN-major: element (row r, col c) is
 * `data[c * 4 + r]`. With R = Ry(yaw)·Rx(pitch)·…, yaw = atan2(R02, R22) and
 * pitch = asin(−R12).
 *
 * Positive yaw rotates the face's forward axis (+Z, towards the camera)
 * towards +X, which is the right of the un-mirrored camera image, i.e. the
 * user's own LEFT.
 */
export function headPose(matrix: ArrayLike<number>): { yaw: number; pitch: number } {
  const at = (r: number, c: number) => matrix[c * 4 + r];
  const deg = 180 / Math.PI;
  const yaw = Math.atan2(at(0, 2), at(2, 2)) * deg;
  const pitch = Math.asin(Math.max(-1, Math.min(1, -at(1, 2)))) * deg;
  return { yaw, pitch };
}

/**
 * Yaw relative to the user: positive when the user turns towards their own
 * left. The preview is mirrored, so this is also "towards the left of the
 * screen" for the user; frames sent to the worker keep the camera's original
 * orientation, which is what `headPose` measures.
 */
export function userYaw(cameraYaw: number): number {
  return cameraYaw;
}

/** Mean of eyeBlinkLeft and eyeBlinkRight (0 = open, 1 = closed). */
export function blinkScore(
  categories: ReadonlyArray<{ categoryName: string; score: number }>
): number {
  let left: number | undefined;
  let right: number | undefined;
  for (const c of categories) {
    if (c.categoryName === "eyeBlinkLeft") left = c.score;
    else if (c.categoryName === "eyeBlinkRight") right = c.score;
  }
  if (left === undefined || right === undefined) return 0;
  return (left + right) / 2;
}

// Face mesh indices: nose alae and the outermost cheek points.
const NOSE_ALA_A = 129;
const NOSE_ALA_B = 358;
const CHEEK_A = 234;
const CHEEK_B = 454;

/**
 * Perspective ratio = nose width / face width (thesis 3.2.3). When a real face
 * approaches the lens, central regions grow faster than the contour; a flat
 * photo grows uniformly and the ratio stays constant.
 */
export function perspectiveRatio(
  landmarks: readonly Landmark[],
  width: number,
  height: number
): number {
  const dist = (i: number, j: number) =>
    Math.hypot(
      (landmarks[i].x - landmarks[j].x) * width,
      (landmarks[i].y - landmarks[j].y) * height
    );
  const face = dist(CHEEK_A, CHEEK_B);
  return face === 0 ? 0 : dist(NOSE_ALA_A, NOSE_ALA_B) / face;
}

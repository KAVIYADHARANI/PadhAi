/**
 * MediaPipe Face Signals Web Worker.
 *
 * Privacy Invariants (README Section 11.2 & 13):
 * 1. Camera frames NEVER leave this worker thread.
 * 2. No frame, bitmap, canvas, or image data is ever stored or uploaded over the network.
 * 3. Only derived numeric telemetry (blinks, yawns, head angles, quality) is posted back.
 */

import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import {
  FaceSignalsPayload,
  FaceWorkerInMessage,
  FaceWorkerOutMessage,
} from "../buddy/types";

// Landmark indices for Eye Aspect Ratio calculation (MediaPipe 468/478 mesh)
export const LEFT_EYE_INDICES = [33, 160, 158, 133, 153, 144];
export const RIGHT_EYE_INDICES = [362, 385, 387, 263, 373, 380];

const DEFAULT_WASM_PATH = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";
const DEFAULT_MODEL_PATH =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

let landmarker: FaceLandmarker | null = null;
let isInitializing = false;

/**
 * Computes 3D Euclidean distance between two landmark points.
 */
export function distance3D(
  p1: { x: number; y: number; z?: number },
  p2: { x: number; y: number; z?: number }
): number {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  const dz = (p1.z || 0) - (p2.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Calculates Eye Aspect Ratio (EAR) from 6 canonical landmarks.
 * Ratio drops significantly when eyes close.
 */
export function calculateEAR(
  landmarks: Array<{ x: number; y: number; z?: number }>,
  indices: number[]
): number {
  if (!landmarks || indices.length < 6) return 0.3;
  const p1 = landmarks[indices[0]]; // outer corner
  const p2 = landmarks[indices[1]]; // top-outer
  const p3 = landmarks[indices[2]]; // top-inner
  const p4 = landmarks[indices[3]]; // inner corner
  const p5 = landmarks[indices[4]]; // bottom-inner
  const p6 = landmarks[indices[5]]; // bottom-outer

  if (!p1 || !p2 || !p3 || !p4 || !p5 || !p6) return 0.3;

  const vertical1 = distance3D(p2, p6);
  const vertical2 = distance3D(p3, p5);
  const horizontal = distance3D(p1, p4);

  if (horizontal === 0) return 0.3;
  return (vertical1 + vertical2) / (2.0 * horizontal);
}

/**
 * Decomposes 4x4 facial transformation matrix (column-major) into Euler angles:
 * Pitch (nod down/up), Yaw (turn left/right), Roll (head tilt).
 */
export function extractEulerAngles(
  matrixData: Float32Array | number[] | undefined
): { pitch: number; yaw: number; roll: number } {
  if (!matrixData || matrixData.length < 16) {
    return { pitch: 0, yaw: 0, roll: 0 };
  }

  // 4x4 column-major order:
  // Column 0: [m0, m1, m2, m3]
  // Column 1: [m4, m5, m6, m7]
  // Column 2: [m8, m9, m10, m11]
  // Column 3: [m12, m13, m14, m15]
  const m1 = matrixData[1];
  const m5 = matrixData[5];
  const m8 = matrixData[8];
  const m9 = matrixData[9];
  const m10 = matrixData[10];

  // pitch: rotation around X axis (nodding). Looking down yields negative degrees.
  const clampedM9 = Math.max(-1, Math.min(1, m9));
  const pitch = Math.asin(-clampedM9) * (180 / Math.PI);

  // yaw: rotation around Y axis (turning head left/right).
  const yaw = Math.atan2(m8, m10) * (180 / Math.PI);

  // roll: rotation around Z axis (tilting head side to side).
  const roll = Math.atan2(m1, m5) * (180 / Math.PI);

  return { pitch, yaw, roll };
}

/**
 * Evaluates tracking quality (0 to 100) based on bounds sanity and normalized face size.
 */
export function calculateQualityScore(
  landmarks: Array<{ x: number; y: number; z?: number }> | undefined,
  faceWidth = 0.25,
  faceHeight = 0.35
): number {
  if (!landmarks || landmarks.length === 0) return 0;

  let inBoundsCount = 0;
  for (const pt of landmarks) {
    if (pt.x >= 0 && pt.x <= 1 && pt.y >= 0 && pt.y <= 1) {
      inBoundsCount++;
    }
  }
  const boundsRatio = inBoundsCount / landmarks.length;

  // Face size factor (ideal is 0.08 to 0.4 of frame area)
  const area = Math.max(0, faceWidth * faceHeight);
  const sizeRatio = Math.min(1.0, area / 0.08);

  const rawScore = boundsRatio * 60 + sizeRatio * 40;
  return Math.max(0, Math.min(100, Math.round(rawScore)));
}

/**
 * Initialize MediaPipe Face Landmarker.
 */
async function initializeLandmarker(
  wasmPath = DEFAULT_WASM_PATH,
  modelPath = DEFAULT_MODEL_PATH
): Promise<void> {
  if (landmarker || isInitializing) return;
  isInitializing = true;

  try {
    const filesetResolver = await FilesetResolver.forVisionTasks(wasmPath);
    landmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: modelPath,
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    });

    const reply: FaceWorkerOutMessage = {
      type: "INITIALIZED",
      success: true,
    };
    self.postMessage(reply);
  } catch (err: any) {
    // Attempt CPU fallback if GPU delegate failed
    try {
      const filesetResolver = await FilesetResolver.forVisionTasks(wasmPath);
      landmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: modelPath,
          delegate: "CPU",
        },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      });

      const reply: FaceWorkerOutMessage = {
        type: "INITIALIZED",
        success: true,
      };
      self.postMessage(reply);
    } catch (fallbackErr: any) {
      const reply: FaceWorkerOutMessage = {
        type: "INITIALIZED",
        success: false,
        error: fallbackErr?.message || err?.message || "Failed to initialize Face Landmarker",
      };
      self.postMessage(reply);
    }
  } finally {
    isInitializing = false;
  }
}

/**
 * Processes incoming ImageBitmap frame and dispatches derived numeric signals.
 */
function processFrame(bitmap: ImageBitmap, timestamp: number): void {
  try {
    if (!landmarker) {
      return;
    }

    const results = landmarker.detectForVideo(bitmap, timestamp);

    const hasFace = Boolean(results.faceLandmarks && results.faceLandmarks.length > 0);

    if (!hasFace) {
      const payload: FaceSignalsPayload = {
        timestamp,
        facePresent: false,
        qualityScore: 0,
        eyeBlinkLeft: 0,
        eyeBlinkRight: 0,
        eyeClosure: 0,
        earFallback: 0.3,
        jawOpen: 0,
        pitchDeg: 0,
        yawDeg: 0,
        rollDeg: 0,
      };

      const msg: FaceWorkerOutMessage = {
        type: "SIGNALS",
        data: payload,
      };
      self.postMessage(msg);
      return;
    }

    const landmarks = results.faceLandmarks[0];

    // 1. Blendshapes (Eye blink and Jaw open)
    let eyeBlinkLeft = 0;
    let eyeBlinkRight = 0;
    let jawOpen = 0;

    if (results.faceBlendshapes && results.faceBlendshapes.length > 0) {
      const categories = results.faceBlendshapes[0].categories;
      for (const cat of categories) {
        if (cat.categoryName === "eyeBlinkLeft") {
          eyeBlinkLeft = cat.score;
        } else if (cat.categoryName === "eyeBlinkRight") {
          eyeBlinkRight = cat.score;
        } else if (cat.categoryName === "jawOpen") {
          jawOpen = cat.score;
        }
      }
    }

    // 2. Ear Fallback calculation
    const earLeft = calculateEAR(landmarks, LEFT_EYE_INDICES);
    const earRight = calculateEAR(landmarks, RIGHT_EYE_INDICES);
    const earFallback = (earLeft + earRight) / 2.0;

    // Average closure metric (prefer blendshape if available, fallback to normalized EAR)
    let eyeClosure = (eyeBlinkLeft + eyeBlinkRight) / 2.0;
    if (eyeClosure === 0 && earFallback < 0.22) {
      eyeClosure = Math.max(0, Math.min(1, (0.28 - earFallback) / 0.1));
    }

    // 3. Head Pose Matrix decomposition
    let pitch = 0;
    let yaw = 0;
    let roll = 0;

    if (
      results.facialTransformationMatrixes &&
      results.facialTransformationMatrixes.length > 0
    ) {
      const matrixData = results.facialTransformationMatrixes[0].data;
      const euler = extractEulerAngles(matrixData);
      pitch = euler.pitch;
      yaw = euler.yaw;
      roll = euler.roll;
    }

    // 4. Quality Score
    // Estimate face width & height from landmark extents
    let minX = 1,
      maxX = 0,
      minY = 1,
      maxY = 0;
    for (const pt of landmarks) {
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }
    const faceWidth = Math.max(0, maxX - minX);
    const faceHeight = Math.max(0, maxY - minY);
    const qualityScore = calculateQualityScore(landmarks, faceWidth, faceHeight);

    const payload: FaceSignalsPayload = {
      timestamp,
      facePresent: true,
      qualityScore,
      eyeBlinkLeft,
      eyeBlinkRight,
      eyeClosure,
      earFallback,
      jawOpen,
      pitchDeg: pitch,
      yawDeg: yaw,
      rollDeg: roll,
    };

    const msg: FaceWorkerOutMessage = {
      type: "SIGNALS",
      data: payload,
    };
    self.postMessage(msg);
  } catch (err: any) {
    const errorMsg: FaceWorkerOutMessage = {
      type: "ERROR",
      error: err?.message || "Error processing face signals frame",
    };
    self.postMessage(errorMsg);
  } finally {
    // Crucial: close ImageBitmap immediately to prevent memory leak
    try {
      bitmap.close();
    } catch {
      // ignore
    }
  }
}

// Worker message router
self.onmessage = async (event: MessageEvent<FaceWorkerInMessage>) => {
  const msg = event.data;
  if (!msg) return;

  switch (msg.type) {
    case "INIT":
      await initializeLandmarker(msg.wasmLoaderPath, msg.modelAssetPath);
      break;
    case "PROCESS_FRAME":
      processFrame(msg.bitmap, msg.timestamp);
      break;
    case "RESET":
      if (landmarker) {
        try {
          landmarker.close();
        } catch {
          // ignore
        }
        landmarker = null;
      }
      break;
  }
};

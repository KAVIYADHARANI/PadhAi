import { describe, expect, it } from "vitest";
import {
  calculateEAR,
  calculateQualityScore,
  distance3D,
  extractEulerAngles,
} from "../workers/face-signals.worker";

describe("face-signals.worker mathematical calculations", () => {
  it("distance3D computes Euclidean distance accurately", () => {
    const p1 = { x: 0, y: 0, z: 0 };
    const p2 = { x: 3, y: 4, z: 0 };
    expect(distance3D(p1, p2)).toBe(5);

    const p3 = { x: 1, y: 2, z: 2 };
    const p4 = { x: 4, y: 6, z: 2 };
    expect(distance3D(p3, p4)).toBe(5);
  });

  it("calculateEAR detects open vs closed eye states", () => {
    // Open eye coordinates: wide vertical distance
    const openEyeLandmarks = [
      { x: 0.1, y: 0.5, z: 0 }, // 0: outer corner
      { x: 0.2, y: 0.4, z: 0 }, // 1: top outer
      { x: 0.3, y: 0.4, z: 0 }, // 2: top inner
      { x: 0.4, y: 0.5, z: 0 }, // 3: inner corner
      { x: 0.3, y: 0.6, z: 0 }, // 4: bottom inner
      { x: 0.2, y: 0.6, z: 0 }, // 5: bottom outer
    ];
    const earOpen = calculateEAR(openEyeLandmarks, [0, 1, 2, 3, 4, 5]);
    expect(earOpen).toBeGreaterThan(0.25);

    // Closed eye coordinates: near zero vertical distance
    const closedEyeLandmarks = [
      { x: 0.1, y: 0.5, z: 0 },
      { x: 0.2, y: 0.505, z: 0 },
      { x: 0.3, y: 0.505, z: 0 },
      { x: 0.4, y: 0.5, z: 0 },
      { x: 0.3, y: 0.495, z: 0 },
      { x: 0.2, y: 0.495, z: 0 },
    ];
    const earClosed = calculateEAR(closedEyeLandmarks, [0, 1, 2, 3, 4, 5]);
    expect(earClosed).toBeLessThan(0.1);
  });

  it("extractEulerAngles extracts Pitch, Yaw, and Roll from 4x4 matrix", () => {
    // 1. Identity matrix (facing directly forward)
    const identityMatrix = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];
    const neutralPose = extractEulerAngles(identityMatrix);
    expect(Math.abs(neutralPose.pitch)).toBeLessThan(0.01);
    expect(Math.abs(neutralPose.yaw)).toBeLessThan(0.01);
    expect(Math.abs(neutralPose.roll)).toBeLessThan(0.01);

    // 2. Head pitched downward (looking down at notes)
    // Rotation around X axis by +30 degrees (m9 = -sin(30 deg) = -0.5, m5 = cos(30 deg) = 0.866)
    const lookingDownMatrix = [
      1, 0, 0, 0,
      0, 0.866, 0.5, 0,
      0, -0.5, 0.866, 0,
      0, 0, 0, 1,
    ];
    const lookingDownPose = extractEulerAngles(lookingDownMatrix);
    expect(lookingDownPose.pitch).toBeCloseTo(30, 0);

    // 3. Head turned right
    // Rotation around Y axis by +45 degrees (m8 = sin(45 deg) = 0.707, m10 = cos(45 deg) = 0.707)
    const turnedRightMatrix = [
      0.707, 0, -0.707, 0,
      0, 1, 0, 0,
      0.707, 0, 0.707, 0,
      0, 0, 0, 1,
    ];
    const turnedRightPose = extractEulerAngles(turnedRightMatrix);
    expect(turnedRightPose.yaw).toBeCloseTo(45, 0);
  });

  it("calculateQualityScore returns high score for centered, in-bounds face", () => {
    const centeredLandmarks = [
      { x: 0.4, y: 0.3 },
      { x: 0.6, y: 0.3 },
      { x: 0.5, y: 0.7 },
    ];
    const quality = calculateQualityScore(centeredLandmarks, 0.3, 0.4);
    expect(quality).toBeGreaterThan(70);
  });

  it("calculateQualityScore returns low score for clipped or out-of-frame landmarks", () => {
    const outOfFrameLandmarks = [
      { x: -0.2, y: 0.1 },
      { x: 1.3, y: 0.2 },
      { x: 0.5, y: 1.5 },
    ];
    const quality = calculateQualityScore(outOfFrameLandmarks, 0.02, 0.02);
    expect(quality).toBeLessThan(30);
  });
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { makeSamples } from "./demo.js";
import { extractFeatures } from "./features.js";
import { classifyWithModel, runModel } from "./model.js";

function classifyDrive(opts: Parameters<typeof makeSamples>[0], speedMps: number) {
  return classifyWithModel(extractFeatures(makeSamples(opts)), speedMps);
}

test("sharp low-rotation strike → pothole (model)", () => {
  const r = classifyDrive(
    {
      durationMs: 600,
      rateHz: 50,
      noise: 0.2,
      impulses: [{ atMs: 300, peak: 10, kind: "sharp", widthMs: 40 }],
    },
    13.4
  );
  assert.equal(r.classification, "pothole");
  assert.ok(r.confidence > 0.5, `confidence ${r.confidence}`);
  assert.ok(r.severity >= 0 && r.severity <= 1, `severity ${r.severity}`);
});

test("rounded high-rotation hump → speed bump (model)", () => {
  const r = classifyDrive(
    {
      durationMs: 600,
      rateHz: 50,
      noise: 0.15,
      gyroNoise: 0.04,
      impulses: [{ atMs: 300, peak: 7, kind: "rounded", widthMs: 300, gyroPeak: 1.2 }],
    },
    8
  );
  assert.equal(r.classification, "speed_bump");
});

test("sustained noise, no discrete impulse → rough_road (model)", () => {
  const r = classifyDrive({ durationMs: 600, rateHz: 50, noise: 1.6, gyroNoise: 0.15 }, 13.4);
  assert.equal(r.classification, "rough_road");
});

test("confidence is the model's own softmax max, not the heuristic ceiling", () => {
  const r = classifyDrive(
    {
      durationMs: 600,
      rateHz: 50,
      noise: 0.2,
      impulses: [{ atMs: 300, peak: 12, kind: "sharp", widthMs: 35 }],
    },
    13.4
  );
  assert.ok(r.confidence > 0 && r.confidence <= 1, `confidence ${r.confidence}`);
});

/**
 * Regression guard: fixed feature vectors + speeds, paired with the exact
 * probabilities TensorFlow produced for them (ml/export/verify_parity_python.py).
 * Catches any accidental drift between model.ts's forward pass and the
 * trained weights it's supposed to reimplement.
 */
test("pure-JS forward pass matches the trained TensorFlow model (parity)", () => {
  const cases: { features: Parameters<typeof runModel>[0]; speedMps: number; pythonProbs: number[] }[] = [
    {
      features: {
        sampleCount: 31, dtMs: 20, peakToPeak: 6.915602288641015, rms: 1.241752932236078,
        maxAbsVert: 3.476873204955748, maxJerk: 176.58045517794605, settleMs: 100,
        verticalDominance: 0.9828405776534364, gyroRms: 0.044937352464074,
      },
      speedMps: 6.78192471826867,
      pythonProbs: [0.9190477132797241, 0.010829431004822254, 0.022460050880908966, 0.04766286537051201],
    },
    {
      features: {
        sampleCount: 31, dtMs: 20, peakToPeak: 3.2341288568257127, rms: 0.8642588421753193,
        maxAbsVert: 1.6729938474272572, maxJerk: 143.79523268683644, settleMs: 480,
        verticalDominance: 0.2621037893851489, gyroRms: 0.1302839853108779,
      },
      speedMps: 10.319101069347502,
      pythonProbs: [0.00002638644764374476, 0.0032129017636179924, 0.9568026065826416, 0.0399581678211689],
    },
    {
      features: {
        sampleCount: 31, dtMs: 20, peakToPeak: 5.857316122915563, rms: 2.1821023801712194,
        maxAbsVert: 3.7075051835421373, maxJerk: 72.28162926877317, settleMs: 280,
        verticalDominance: 0.9866945249333604, gyroRms: 0.9279402287637064,
      },
      speedMps: 9.300468801251942,
      pythonProbs: [0.03661337122321129, 0.8875738978385925, 0.07581249624490738, 1.7184132161673915e-7],
    },
    {
      features: {
        sampleCount: 31, dtMs: 20, peakToPeak: 4.908800554540443, rms: 1.5207642892091642,
        maxAbsVert: 3.5475143972912733, maxJerk: 99.7969750577984, settleMs: 280,
        verticalDominance: 0.8692619061736387, gyroRms: 0.03975565400204368,
      },
      speedMps: 21.57403821693544,
      pythonProbs: [0.00034693119232542813, 0.0007136831409297884, 0.0005476503283716738, 0.9983918070793152],
    },
  ];

  for (const c of cases) {
    const { probs } = runModel(c.features, c.speedMps);
    const jsArgmax = probs.indexOf(Math.max(...probs));
    const pyArgmax = c.pythonProbs.indexOf(Math.max(...c.pythonProbs));
    assert.equal(jsArgmax, pyArgmax, `argmax mismatch: js=${jsArgmax} py=${pyArgmax}`);
    for (let i = 0; i < probs.length; i++) {
      const diff = Math.abs(probs[i]! - c.pythonProbs[i]!);
      assert.ok(diff < 0.01, `class ${i} prob diff ${diff} too large (js=${probs[i]} py=${c.pythonProbs[i]})`);
    }
  }
});

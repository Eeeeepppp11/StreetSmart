"""Dumps model predictions on a handful of real dataset rows so the pure-JS
forward pass (packages/detector/src/model.ts) can be checked for numerical
parity against the actual Keras model. Not part of the regular pipeline —
a one-off correctness check."""
import json
import os
import random

import numpy as np
import tensorflow as tf

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(HERE, "..", "training", "artifacts", "pothole_model.keras")
DATA_PATH = os.path.join(HERE, "..", "data", "synthetic_dataset.json")
METRICS_PATH = os.path.join(HERE, "..", "training", "artifacts", "metrics.json")
OUT_PATH = os.path.join(HERE, "artifacts", "parity_check.json")

with open(METRICS_PATH, "r", encoding="utf-8") as f:
    feature_order = json.load(f)["feature_order"]

with open(DATA_PATH, "r", encoding="utf-8") as f:
    rows = json.load(f)

random.seed(42)
sample_rows = random.sample(rows, 25)

model = tf.keras.models.load_model(MODEL_PATH)

cases = []
for row in sample_rows:
    x = np.array(
        [[row["features"][k] if k != "speedMps" else row["speedMps"] for k in feature_order]],
        dtype=np.float32,
    )
    probs = model.predict(x, verbose=0)[0].tolist()
    cases.append({
        "features": row["features"],
        "speedMps": row["speedMps"],
        "pythonProbs": probs,
    })

with open(OUT_PATH, "w", encoding="utf-8") as f:
    json.dump(cases, f, indent=2)
print(f"Wrote {len(cases)} parity cases to {OUT_PATH}")

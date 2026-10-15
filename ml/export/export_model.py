"""
Exports the trained Keras model two ways:
  1. .tflite — for react-native-fast-tflite, once the app leaves Expo Go for a
     custom dev client (native TFLite modules can't run in Expo Go).
  2. weights.json — a portable dump of the Normalization + Dense layer
     parameters, consumed by packages/detector/src/model.ts's pure-JS forward
     pass. This is what actually ships in the Expo Go app today.

Usage: python export_model.py
"""
import json
import os

import numpy as np
import tensorflow as tf

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(HERE, "..", "training", "artifacts", "pothole_model.keras")
METRICS_PATH = os.path.join(HERE, "..", "training", "artifacts", "metrics.json")
ARTIFACTS_DIR = os.path.join(HERE, "artifacts")
MODEL_VERSION = "mlp-v1"


def export_tflite(model: tf.keras.Model) -> str:
    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    tflite_bytes = converter.convert()
    out_path = os.path.join(ARTIFACTS_DIR, f"{MODEL_VERSION}.tflite")
    with open(out_path, "wb") as f:
        f.write(tflite_bytes)
    return out_path


def export_js_weights(model: tf.keras.Model, feature_order, labels) -> str:
    normalizer = model.layers[0]
    mean = normalizer.mean.numpy().reshape(-1).tolist()
    variance = normalizer.variance.numpy().reshape(-1).tolist()

    dense_layers = [l for l in model.layers[1:] if isinstance(l, tf.keras.layers.Dense)]
    layers_json = []
    for layer in dense_layers:
        w, b = layer.get_weights()
        layers_json.append({
            "weights": w.tolist(),  # shape [in, out]
            "bias": b.tolist(),
            "activation": layer.activation.__name__,  # "relu" or "softmax"
        })

    payload = {
        "modelVersion": MODEL_VERSION,
        "featureOrder": feature_order,
        "labels": labels,
        "normalization": {"mean": mean, "variance": variance, "epsilon": 1e-3},
        "layers": layers_json,
    }
    out_path = os.path.join(ARTIFACTS_DIR, "model_weights.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f)
    return out_path


def main():
    os.makedirs(ARTIFACTS_DIR, exist_ok=True)
    model = tf.keras.models.load_model(MODEL_PATH)

    with open(METRICS_PATH, "r", encoding="utf-8") as f:
        metrics = json.load(f)
    feature_order = metrics["feature_order"]
    labels = metrics["labels"]

    tflite_path = export_tflite(model)
    print(f"Wrote {tflite_path} ({os.path.getsize(tflite_path)} bytes)")

    weights_path = export_js_weights(model, feature_order, labels)
    print(f"Wrote {weights_path} ({os.path.getsize(weights_path)} bytes)")


if __name__ == "__main__":
    main()

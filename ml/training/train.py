"""
Trains a small MLP to classify jolt-candidate windows (pothole / speed_bump /
rough_road / other) from the SAME JoltFeatures vector the on-device detector
computes, plus vehicle speed. Trained on ml/data/training_dataset.json (simulated sensor windows).

Usage:
    pip install -r requirements.txt
    python train.py
"""
import json
import os

import numpy as np
import tensorflow as tf
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.model_selection import train_test_split

SEED = 7
np.random.seed(SEED)
tf.random.set_seed(SEED)

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(HERE, "..", "data", "training_dataset.json")
ARTIFACTS_DIR = os.path.join(HERE, "artifacts")

# Fixed order — the exported TFLite model and the pure-JS reimplementation
# both must agree on this exact input/output ordering.
FEATURE_ORDER = [
    "sampleCount", "dtMs", "peakToPeak", "rms", "maxAbsVert",
    "maxJerk", "settleMs", "verticalDominance", "gyroRms", "speedMps",
]
LABELS = ["pothole", "speed_bump", "rough_road", "other"]


def load_dataset():
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        rows = json.load(f)
    X = np.zeros((len(rows), len(FEATURE_ORDER)), dtype=np.float32)
    y = np.zeros((len(rows),), dtype=np.int64)
    for i, row in enumerate(rows):
        f_ = row["features"]
        values = [f_[k] if k != "speedMps" else row["speedMps"] for k in FEATURE_ORDER]
        X[i] = values
        y[i] = LABELS.index(row["label"])
    return X, y


def build_model(x_train: np.ndarray) -> tf.keras.Model:
    normalizer = tf.keras.layers.Normalization(axis=-1)
    normalizer.adapt(x_train)
    model = tf.keras.Sequential([
        tf.keras.layers.Input(shape=(len(FEATURE_ORDER),), name="jolt_features"),
        normalizer,
        tf.keras.layers.Dense(32, activation="relu"),
        tf.keras.layers.Dense(16, activation="relu"),
        tf.keras.layers.Dense(len(LABELS), activation="softmax", name="classification"),
    ])
    model.compile(
        optimizer=tf.keras.optimizers.Adam(1e-3),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    return model


def pothole_false_positive_rate(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    pothole_idx = LABELS.index("pothole")
    non_pothole = y_true != pothole_idx
    if non_pothole.sum() == 0:
        return 0.0
    predicted_pothole = y_pred[non_pothole] == pothole_idx
    return float(predicted_pothole.mean())


def main():
    os.makedirs(ARTIFACTS_DIR, exist_ok=True)

    X, y = load_dataset()
    print(f"Loaded {len(X)} rows, {len(LABELS)} classes")

    x_train, x_temp, y_train, y_temp = train_test_split(
        X, y, test_size=0.3, random_state=SEED, stratify=y
    )
    x_val, x_test, y_val, y_test = train_test_split(
        x_temp, y_temp, test_size=0.5, random_state=SEED, stratify=y_temp
    )
    print(f"train={len(x_train)} val={len(x_val)} test={len(x_test)}")

    model = build_model(x_train)
    model.summary()

    early_stop = tf.keras.callbacks.EarlyStopping(
        monitor="val_loss", patience=8, restore_best_weights=True
    )
    model.fit(
        x_train, y_train,
        validation_data=(x_val, y_val),
        epochs=100,
        batch_size=64,
        callbacks=[early_stop],
        verbose=2,
    )

    test_loss, test_acc = model.evaluate(x_test, y_test, verbose=0)
    y_pred = np.argmax(model.predict(x_test, verbose=0), axis=1)
    fp_rate = pothole_false_positive_rate(y_test, y_pred)
    report = classification_report(y_test, y_pred, target_names=LABELS, output_dict=True)
    cm = confusion_matrix(y_test, y_pred).tolist()

    print("\n=== Test results ===")
    print(f"accuracy: {test_acc:.4f}  loss: {test_loss:.4f}")
    print(f"pothole false-positive rate (non-pothole predicted as pothole): {fp_rate:.4f}")
    print(classification_report(y_test, y_pred, target_names=LABELS))
    print("confusion matrix (rows=true, cols=pred):", LABELS)
    for row in cm:
        print(row)

    model_path = os.path.join(ARTIFACTS_DIR, "pothole_model.keras")
    model.save(model_path)
    print(f"\nSaved model to {model_path}")

    metrics = {
        "feature_order": FEATURE_ORDER,
        "labels": LABELS,
        "test_accuracy": test_acc,
        "test_loss": test_loss,
        "pothole_false_positive_rate": fp_rate,
        "classification_report": report,
        "confusion_matrix": cm,
        "dataset_size": len(X),
        "train_size": len(x_train),
        "val_size": len(x_val),
        "test_size": len(x_test),
        "note": "Trained on simulated sensor data.",
    }
    metrics_path = os.path.join(ARTIFACTS_DIR, "metrics.json")
    with open(metrics_path, "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2)
    print(f"Saved metrics to {metrics_path}")


if __name__ == "__main__":
    main()

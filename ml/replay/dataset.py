"""Labeled-dataset plumbing: pull the labeled set from the ingestion server
(`GET /v1/training-data`, rows shaped like StoredEventRow in
services/ingestion/src/server.ts) and load/save it locally under ml/data/.

ml/data/ is git-ignored: rows carry precise locations from the pilot phone, so
they stay out of the repo; the ingestion server's SQLite file is the source of
truth.
"""

from __future__ import annotations

import json
import urllib.request
from pathlib import Path
from typing import Any

from .bridge import ML_ROOT

DEFAULT_LABELED_PATH = ML_ROOT / "data" / "labeled" / "training-data.json"


def fetch_training_data(server_url: str, timeout: float = 30.0) -> list[dict[str, Any]]:
    """Pull all labeled events from the ingestion server."""
    url = server_url.rstrip("/") + "/v1/training-data"
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    events = body.get("events")
    if not isinstance(events, list):
        raise ValueError(f"unexpected response from {url}: no `events` array")
    return events


def save_labeled(events: list[dict[str, Any]], path: Path = DEFAULT_LABELED_PATH) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"events": events}, indent=1), encoding="utf-8")
    return path


def load_labeled(path: Path = DEFAULT_LABELED_PATH) -> list[dict[str, Any]]:
    if not path.exists():
        raise FileNotFoundError(
            f"{path} not found — pull it first: "
            "uv run python -m replay.cli pull --server http://<lan-host>:<port>"
        )
    body = json.loads(path.read_text(encoding="utf-8"))
    return body["events"] if isinstance(body, dict) else body

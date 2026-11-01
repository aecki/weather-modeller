"""Cached official source downloads with retries and source provenance."""

import hashlib
import json
import subprocess
import time
from datetime import UTC, datetime

from .storage import atomic_write_bytes, write_json

FOEN_API = "https://data.bafu.admin.ch/api"


class SourceClient:
    def __init__(self, root, refresh=False):
        self.root, self.refresh = root, refresh
        self.cache = root / "data" / "raw"
        self.cache.mkdir(parents=True, exist_ok=True)
        self.manifest = []

    def fetch(self, url, key, body=None):
        path = self.cache / key
        request_path = path.with_suffix(path.suffix + ".request.json")
        request = {"url": url, "body": body}
        cached_request = (
            json.loads(request_path.read_text(encoding="utf-8")) if request_path.exists() else None
        )
        if self.refresh or not path.exists() or cached_request != request:
            command = ["curl", "--fail", "--silent", "--show-error", "--max-time", "90", url]
            if body is not None:
                command += ["-H", "Content-Type: application/json", "--data-binary", "@-"]
            for attempt in range(4):
                try:
                    result = subprocess.run(
                        command,
                        input=json.dumps(body).encode() if body is not None else None,
                        capture_output=True,
                        check=True,
                    )
                    atomic_write_bytes(path, result.stdout)
                    write_json(request_path, request)
                    break
                except subprocess.CalledProcessError as error:
                    if attempt == 3:
                        raise RuntimeError(
                            f"Download failed for {url}: {error.stderr.decode(errors='replace')}"
                        ) from error
                    time.sleep(2**attempt)
        raw = path.read_bytes()
        self.manifest.append(
            {
                "url": url,
                "file": path.relative_to(self.root).as_posix(),
                "sha256": hashlib.sha256(raw).hexdigest(),
                "retrievedAt": datetime.fromtimestamp(path.stat().st_mtime, UTC).isoformat(),
                **({"request": body} if body is not None else {}),
            }
        )
        return raw

    def graphql(self, query, key):
        response = json.loads(self.fetch(FOEN_API, key, {"query": query}))
        if response.get("errors"):
            raise RuntimeError(f"FOEN GraphQL error: {response['errors']}")
        return response["data"]["water"]["observations"]

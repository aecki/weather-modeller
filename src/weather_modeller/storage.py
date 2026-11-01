"""Atomic file replacement, with temporary files kept beside their destination."""

import json
import os
import tempfile
from pathlib import Path


def atomic_write_bytes(path: Path, content: bytes) -> None:
    """Readers see the old complete file or the new complete file, never partial bytes."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            dir=path.parent, prefix=f".{path.name}-", suffix=".tmp", delete=False
        ) as stream:
            temporary = Path(stream.name)
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def write_json(path: Path, value, *, compact: bool = False) -> None:
    options = {"separators": (",", ":")} if compact else {"indent": 2}
    content = json.dumps(value, ensure_ascii=False, allow_nan=False, **options) + "\n"
    atomic_write_bytes(path, content.encode("utf-8"))

"""Explicit pinned FOEN catchment download (Deflate64 ZIP entry), repository cache only."""

import hashlib
import json
import sys
import urllib.request
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    import inflate64

    if Path(sys.prefix).resolve() != (ROOT / ".environments/weather-modeller").resolve():
        raise SystemExit("Use the repository environment")
    specification = json.loads((ROOT / "data/reference/lake-recovery/catchments.json").read_text())[
        "source"
    ]
    folder = ROOT / "data/raw/lake-prototype"
    folder.mkdir(parents=True, exist_ok=True)
    output = folder / "total-catchments.gpkg"
    if (
        output.exists()
        and hashlib.file_digest(output.open("rb"), "sha256").hexdigest() == specification["sha256"]
    ):
        print("Pinned catchment file already verified")
        return
    first, last = specification["range"]
    request = urllib.request.Request(
        specification["url"], headers={"Range": f"bytes={first}-{last}"}
    )
    staged = folder / "total-catchments.part"
    inflater = inflate64.Inflater()
    sha = hashlib.sha256()
    crc = 0
    compressed = 0
    try:
        with (
            urllib.request.urlopen(request, timeout=120) as response,
            staged.open("wb") as destination,
        ):
            if response.status != 206 or not response.headers.get("Content-Range", "").startswith(
                f"bytes {first}-{last}/"
            ):
                raise ValueError("Catchment server did not return the pinned byte range")
            while chunk := response.read(1024 * 1024):
                compressed += len(chunk)
                decoded = inflater.inflate(chunk)
                sha.update(decoded)
                crc = zlib.crc32(decoded, crc)
                destination.write(decoded)
        if (
            compressed != last - first + 1
            or sha.hexdigest() != specification["sha256"]
            or crc != specification["crc32"]
        ):
            raise ValueError("Catchment source integrity failure")
        staged.replace(output)
        (folder / "total-source.json").write_text(json.dumps(specification) + "\n")
    finally:
        staged.unlink(missing_ok=True)
    print("Verified official catchment archive entry")


if __name__ == "__main__":
    main()

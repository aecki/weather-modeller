"""Inspect or verify the exact regional data artifact before one-time publication."""

import hashlib
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def verify(root=ROOT):
    config = json.loads((root / "config/regional-models.json").read_text())
    for path, expected in (
        ("outputs/regional-models.tar.gz", config["archiveSha256"]),
        ("data/processed/regional-models/manifest.json", config["manifestSha256"]),
    ):
        if hashlib.sha256((root / path).read_bytes()).hexdigest() != expected:
            raise ValueError(f"Prepared regional reference checksum mismatch: {path}")
    manifest = json.loads((root / "data/processed/regional-models/manifest.json").read_text())
    if manifest["referenceId"] != config["referenceId"]:
        raise ValueError("Prepared regional reference identity mismatch")
    print("Prepared archive, manifest and regional reference match the pinned identities.")


def inspect(root=ROOT):
    config = json.loads((root / "config/regional-models.json").read_text())
    url = f"https://api.github.com/repos/{config['repository']}/releases/tags/{urllib.parse.quote(config['releaseTag'], safe='')}"
    request = urllib.request.Request(
        url,
        headers={
            "Authorization": "Bearer " + os.environ["GH_TOKEN"],
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            release = json.load(response)
        exists = any(asset["name"] == config["assetName"] for asset in release["assets"])
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        exists = False
    with Path(os.environ["GITHUB_OUTPUT"]).open("a") as output:
        output.write(f"exists={str(exists).lower()}\n")
    with Path(os.environ["GITHUB_ENV"]).open("a") as env:
        env.write(f"REFERENCE_TAG={config['releaseTag']}\n")
    print(
        "Pinned data release already exists."
        if exists
        else "Pinned data release needs initial preparation."
    )


if __name__ == "__main__":
    if sys.argv[1:] == ["inspect"]:
        inspect()
    elif sys.argv[1:] == ["verify"]:
        verify()
    else:
        raise SystemExit("Usage: regional_reference_release.py inspect|verify")

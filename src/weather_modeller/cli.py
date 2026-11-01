"""Local app commands. Serving and checking never contact a remote service."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse
import json
import os
import shutil
import subprocess
import sys

from .project import project_root


def build(root):
    source = root / "web"
    data = root / "data" / "processed"
    for name in ("observations.json", "provenance.json"):
        json.loads((data / name).read_text(encoding="utf-8"))
    output = root / "dist"
    # Output is disposable; only replace this application's generated directory.
    if output.is_symlink():
        raise ValueError("Refusing to build into a symlinked dist directory")
    if output.exists():
        shutil.rmtree(output)
    shutil.copytree(source, output)
    shutil.copytree(data, output / "data")
    print(f"Built self-contained app: {output}", flush=True)
    return output


def check(root):
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Node.js is missing; use the repository-local Conda environment")
    subprocess.run([sys.executable, "-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py", "-v"], cwd=root, check=True)
    for path in ("app.js", "data-core.js"):
        subprocess.run([node, "--check", str(root / "web" / path)], check=True)
    subprocess.run([node, str(root / "tests" / "test_data.cjs")], cwd=root, check=True)
    output = build(root)
    # Every local entrypoint asset must be present in the packaged app.
    for path in ("index.html", "style.css", "app.js", "data-core.js", "vendor/leaflet.js", "vendor/leaflet.css", "geography/countries.geojson", "geography/lakes.geojson", "data/observations.json"):
        if not (output / path).is_file():
            raise ValueError(f"Missing application asset: {path}")
    print("All local checks passed.")


class LocalAppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, root, **kwargs):
        self.root = root
        super().__init__(*args, directory=str(root / "dist"), **kwargs)

    def do_POST(self):
        if self.path != "/api/exports":
            self.send_error(404)
            return
        port = self.server.server_port
        hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
        host = self.headers.get("Host", "")
        if host not in hosts or self.headers.get("Origin") != "http://" + host:
            self.send_error(403, "Exports are only available from this local app")
            return
        if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
            self.send_error(415)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 4096:
                self.send_error(413)
                return
            selection = json.loads(self.rfile.read(length))
            if not isinstance(selection, dict):
                raise ValueError("Selection must be an object")
            from .exports import save_selection
            path = save_selection(self.root, selection)
        except (ValueError, OSError) as error:
            payload = json.dumps({"error": str(error)}).encode()
            self.send_response(400)
        else:
            payload = json.dumps({"path": path}).encode()
            self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def main():
    parser = argparse.ArgumentParser(description="Swiss Catastrophe Lab: repository-local observation explorer")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("build", help="Build the self-contained app without network access")
    commands.add_parser("check", help="Run offline integrity and numerical checks")
    fetch = commands.add_parser("fetch", help="Explicitly download official Swiss observations")
    fetch.add_argument("--refresh", action="store_true", help="Replace cached downloads with fresh source responses")
    serve = commands.add_parser("serve", help="Build and serve on localhost; no external services")
    serve.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    root = project_root()
    # Ensure Node and curl resolve from this interpreter's Conda prefix on every OS.
    prefix = Path(sys.prefix)
    bins = [prefix, prefix / "Scripts", prefix / "Library" / "bin"] if os.name == "nt" else [prefix / "bin"]
    os.environ["PATH"] = os.pathsep.join(map(str, bins)) + os.pathsep + os.environ.get("PATH", "")
    try:
        if args.command == "fetch":
            from .ingestion import fetch_observations
            fetch_observations(root, refresh=args.refresh)
        elif args.command == "build":
            build(root)
        elif args.command == "check":
            check(root)
        elif args.command == "serve":
            output = build(root)
            handler = partial(LocalAppHandler, root=root)
            with ThreadingHTTPServer(("127.0.0.1", args.port), handler) as server:
                print(f"Swiss Catastrophe Lab: http://127.0.0.1:{args.port}\nPress Ctrl+C to stop.", flush=True)
                server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Error: {error}\n")

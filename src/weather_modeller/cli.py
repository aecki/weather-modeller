"""Local app commands. Serving and checking never contact a remote service."""

import argparse
import os
import subprocess
import sys
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path

from .build import build
from .checks import check
from .project import project_root
from .server import LocalAppHandler


def main():
    parser = argparse.ArgumentParser(
        description="Swiss Catastrophe Lab: repository-local observation explorer"
    )
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("dev", help="Install optional developer tools locally (requires internet)")
    commands.add_parser("build", help="Build the self-contained app without network access")
    commands.add_parser("check", help="Run offline integrity and numerical checks")
    commands.add_parser("quality", help="Check Python and frontend style with installed dev tools")
    fetch = commands.add_parser("fetch", help="Explicitly download official Swiss observations")
    fetch.add_argument(
        "--refresh",
        action="store_true",
        help="Replace cached downloads with fresh source responses",
    )
    serve = commands.add_parser("serve", help="Build and serve on localhost; no external services")
    serve.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    root = project_root()
    # Ensure Node and curl resolve from this interpreter's Conda prefix on every OS.
    prefix = Path(sys.prefix)
    bins = (
        [prefix, prefix / "Scripts", prefix / "Library" / "bin"]
        if os.name == "nt"
        else [prefix / "bin"]
    )
    os.environ["PATH"] = os.pathsep.join(map(str, bins)) + os.pathsep + os.environ.get("PATH", "")
    try:
        if args.command == "dev":
            from .development import install_dev_tools

            install_dev_tools(root)
        elif args.command == "fetch":
            from .ingestion import fetch_observations

            fetch_observations(root, refresh=args.refresh)
        elif args.command == "build":
            build(root)
        elif args.command == "check":
            check(root)
        elif args.command == "quality":
            from .checks import quality

            quality(root)
        elif args.command == "serve":
            build(root)
            handler = partial(LocalAppHandler, root=root)
            with ThreadingHTTPServer(("127.0.0.1", args.port), handler) as server:
                print(
                    f"Swiss Catastrophe Lab: http://127.0.0.1:{args.port}\nPress Ctrl+C to stop.",
                    flush=True,
                )
                server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Error: {error}\n")

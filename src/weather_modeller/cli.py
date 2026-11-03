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
        description="aecki’s catastrophe lab: repository-local observation explorer"
    )
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser(
        "install-frontend", help="Install repository-local frontend build dependencies"
    )
    commands.add_parser("dev", help="Install optional developer tools locally (requires internet)")
    commands.add_parser(
        "regional-deps", help="Install optional daily ingestion dependencies inside the repository"
    )
    commands.add_parser("build", help="Build the static site without network access")
    commands.add_parser("check", help="Run offline integrity and numerical checks")
    commands.add_parser("quality", help="Check Python and frontend style with installed dev tools")
    fetch = commands.add_parser("fetch", help="Explicitly download official Swiss observations")
    fetch.add_argument(
        "--refresh",
        action="store_true",
        help="Replace cached downloads with fresh source responses",
    )
    regional = commands.add_parser(
        "fetch-regional",
        help="Refresh the daily regional release (requires optional GIS tools and internet)",
    )
    regional.add_argument("--days", type=int, default=90)
    regional.add_argument(
        "--through",
        help="Last rainfall-day label, YYYY-MM-DD (default latest complete UTC rainfall day)",
    )
    commands.add_parser(
        "history-deps", help="Install optional historical reference preparation tools"
    )
    history = commands.add_parser(
        "prepare-history",
        help="Explicitly prepare a versioned regional reference from annual archives",
    )
    history.add_argument("--start", type=int, default=1961)
    history.add_argument("--end", type=int, default=2025)
    commands.add_parser(
        "restore-history",
        help="Restore the pinned reference artifact for Pages (requires GitHub token)",
    )
    commands.add_parser(
        "prepare-regional-models",
        help="Prepare regional annual maxima from the pinned real archive",
    )
    commands.add_parser(
        "restore-regional-models", help="Restore the pinned regional modelling reference"
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
        if args.command == "install-frontend":
            from .development import install_frontend

            install_frontend(root)
        elif args.command == "dev":
            from .development import install_dev_tools

            install_dev_tools(root)
        elif args.command == "regional-deps":
            from .development import install_regional_tools

            install_regional_tools(root)
        elif args.command == "fetch":
            from .ingestion import fetch_observations

            fetch_observations(root, refresh=args.refresh)
        elif args.command == "fetch-regional":
            from .regional import fetch_regional

            fetch_regional(root, days=args.days, through=args.through)
        elif args.command == "history-deps":
            from .development import install_history_tools

            install_history_tools(root)
        elif args.command == "prepare-history":
            from .regional_history import prepare_history

            prepare_history(root, args.start, args.end)
        elif args.command == "restore-history":
            from .regional_history import restore_history

            restore_history(root)
        elif args.command == "prepare-regional-models":
            from .regional_models import prepare_models

            prepare_models(root)
        elif args.command == "restore-regional-models":
            from .regional_history import restore_history

            restore_history(root, "regional-models")
        elif args.command == "build":
            build(root)
        elif args.command == "check":
            check(root)
        elif args.command == "quality":
            from .checks import quality

            quality(root)
        elif args.command == "serve":
            build(root, export_mode="repository")
            handler = partial(LocalAppHandler, root=root)
            with ThreadingHTTPServer(("127.0.0.1", args.port), handler) as server:
                print(
                    f"aecki’s catastrophe lab: http://127.0.0.1:{args.port}\nPress Ctrl+C to stop.",
                    flush=True,
                )
                server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Error: {error}\n")

"""Loopback HTTP serving and validated, same-origin CSV export requests."""

import json
from http.server import SimpleHTTPRequestHandler


class LocalAppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, root, **kwargs):
        self.root = root
        super().__init__(*args, directory=str(root / "dist"), **kwargs)

    def do_GET(self):
        if self.path.partition("?")[0] == "/runtime-config.json":
            payload = json.dumps({"exportMode": "repository"}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        super().do_GET()

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

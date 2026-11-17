"""The dogbone browser view and MCP endpoint for one open KiCad board."""
import argparse
from hashlib import sha256
import json
from pathlib import Path
from shutil import which
import subprocess
from tempfile import TemporaryDirectory
from threading import Lock

import uvicorn
from starlette.concurrency import run_in_threadpool
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.responses import FileResponse, Response
from starlette.staticfiles import StaticFiles

from .kicad import Connector, make_server


WEB = Path(__file__).resolve().parent / "web"
CLI = which("kicad-cli") or "/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli"
BOARD_LAYERS = ("F.Cu", "B.Cu", "F.Silkscreen", "Edge.Cuts")
EXPORTS = {
    "svg": ("image/svg+xml", 8, (
        "--mode-single",
        "--fit-page-to-board", "--exclude-drawing-sheet",
    )),
    "glb": ("model/gltf-binary", 45, (
        "--force", "--include-soldermask", "--include-silkscreen", "--include-pads",
    )),
}


class Preview:
    def __init__(self, board_path):
        document = board_path.read_bytes()
        self.snapshot = sha256(document).hexdigest(), document
        self.model_root = json.dumps(str(board_path.parent), ensure_ascii=False)[1:-1].encode()
        self.temp = TemporaryDirectory(prefix="dogbone-")
        self.cache = {}
        self.locks = {kind: Lock() for kind in EXPORTS}

    def publish(self, revision, document):
        self.snapshot = revision, document

    def export(self, kind, layers):
        # Deduplicate concurrent viewers. SVG and GLB export independently.
        with self.locks[kind]:
            revision, document = self.snapshot
            cached = self.cache.get(kind)
            if cached and cached[:2] == (revision, layers):
                return revision, cached[2]

            folder = Path(self.temp.name)
            source, output = folder / f"{kind}.kicad_pcb", folder / f"board.{kind}"
            if kind == "glb":
                document = document.replace(b'${KIPRJMOD}', self.model_root)
            source.write_bytes(document)
            _, timeout, options = EXPORTS[kind]
            if kind == "svg":
                options = ("--layers", ",".join(layers), *options)
            subprocess.run(
                [CLI, "pcb", "export", kind, *options, "--output", str(output), str(source)],
                check=True, capture_output=True, timeout=timeout,
            )
            data = output.read_bytes()
            self.cache[kind] = revision, layers, data
            return revision, data


def create_app(board_path, socket):
    preview = Preview(board_path.resolve(strict=True))
    connector = Connector(board_path, socket, on_snapshot=preview.publish)
    server = make_server(connector)
    server.settings.stateless_http = True
    server.settings.json_response = True
    labels_path = connector.path.with_suffix(".labels.json")

    def read_labels():
        with connector.lock:
            result = connector.part_labels()
        if labels_path.is_file():
            labels = json.loads(labels_path.read_text())
            for part in result["parts"]:
                details = labels.get(part["ref"], {})
                for key in ("name", "description", "group"):
                    if isinstance(details.get(key), str):
                        part[key] = details[key]
        return result

    @server.custom_route("/", methods=["GET"])
    async def page(_request):
        return FileResponse(WEB / "index.html", headers={"Cache-Control": "no-store"})

    @server.custom_route("/parts.json", methods=["GET"])
    async def parts(_request):
        try:
            result = await run_in_threadpool(read_labels)
        except Exception as error:
            print(f"KiCad label read failed: {error}", flush=True)
            return Response("Part labels unavailable", status_code=503)
        return Response(json.dumps(result), media_type="application/json", headers={"Cache-Control": "no-store"})

    @server.custom_route("/frame.svg", methods=["GET"])
    @server.custom_route("/model.glb", methods=["GET"])
    async def render(request):
        kind = request.url.path.rsplit(".", 1)[-1]
        layers = BOARD_LAYERS if kind == "svg" else ()
        if kind == "svg" and "layers" in request.query_params:
            layers = tuple(request.query_params["layers"].split(","))
            if len(layers) != len(set(layers)) or not set(layers) <= set(BOARD_LAYERS):
                return Response("Unknown board layer", status_code=400)
        revision, _ = preview.snapshot
        etag = request.headers.get("If-None-Match")
        if etag == f'"{revision}"':
            return Response(status_code=304, headers={"ETag": etag, "Cache-Control": "no-cache"})
        try:
            revision, data = await run_in_threadpool(preview.export, kind, layers)
        except (subprocess.SubprocessError, OSError) as error:
            print(f"KiCad {kind} export failed: {error}", flush=True)
            return Response("KiCad export failed", status_code=503)
        headers = {"ETag": f'"{revision}"', "Cache-Control": "no-cache"}
        return Response(data, media_type=EXPORTS[kind][0], headers=headers)

    app = server.streamable_http_app()
    app.mount("/preview-assets", StaticFiles(directory=WEB))
    return TrustedHostMiddleware(app, allowed_hosts=["localhost", "127.0.0.1"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--board", required=True, type=Path)
    parser.add_argument("--socket", default="ipc:///tmp/kicad/api.sock")
    parser.add_argument("--port", default=4083, type=int)
    args = parser.parse_args()
    uvicorn.run(create_app(args.board, args.socket), host="127.0.0.1", port=args.port, access_log=False)


if __name__ == "__main__":
    main()

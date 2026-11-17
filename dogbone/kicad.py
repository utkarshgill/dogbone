"""Small, board-scoped MCP connector for the running KiCad PCB Editor."""
from __future__ import annotations

from functools import wraps
from hashlib import sha256
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import RLock
from time import monotonic, sleep

from kipy import KiCad
from kipy.board_types import BoardLayer
from kipy.geometry import Vector2
from kipy.proto.common.types import DocumentType
from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, ConfigDict, Field


class Placement(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    reference: str = Field(min_length=1, max_length=64)
    x_mm: float = Field(ge=-1000, le=1000)
    y_mm: float = Field(ge=-1000, le=1000)


class Connector:
    def __init__(self, board_path: Path, socket: str, *, on_snapshot=None):
        self.path = board_path.resolve(strict=True)
        self.socket = socket
        self.api = None
        self.lock = RLock()
        self.undo_stack = []
        self.redo_stack = []
        self.temp = TemporaryDirectory(prefix="kicad-connector-")
        self.on_snapshot = on_snapshot

    def board(self):
        if self.api is None:
            self.api = KiCad(socket_path=self.socket, client_name="dogbone", timeout_ms=5000)
        docs = self.api.get_open_documents(DocumentType.DOCTYPE_PCB)
        paths = []
        for doc in docs:
            path = Path(doc.board_filename)
            paths.append((Path(doc.project.path) / path).resolve() if not path.is_absolute() else path.resolve())
        if paths != [self.path]:
            raise ValueError(f"Wrong document. Expected {self.path}; open: {paths}")
        return self.api.get_board()

    def revision(self, board):
        # SaveCopyDocument serializes the LIVE board without saving or retargeting it.
        path = Path(self.temp.name) / "snapshot.kicad_pcb"
        board.save_as(str(path), overwrite=True, include_project=False)
        document = path.read_bytes()
        revision = sha256(document).hexdigest()
        if self.on_snapshot is not None:
            self.on_snapshot(revision, document)
        return revision

    def checked(self, expected_revision):
        board = self.board()
        actual = self.revision(board)
        if actual != expected_revision:
            raise ValueError("Board changed since inspection. Inspect again before editing.")
        return board

    @staticmethod
    def parts(board):
        parts = board.get_footprints()
        result = {p.reference_field.text.value: p for p in parts}
        if len(result) != len(parts):
            raise ValueError("Duplicate footprint references; refusing ambiguous edits.")
        return result

    @staticmethod
    def describe(part):
        return {"reference": part.reference_field.text.value,
                "x_mm": part.position.x / 1e6, "y_mm": part.position.y / 1e6,
                "angle_deg": part.orientation.degrees, "locked": bool(part.locked)}

    def status(self):
        board = self.board()
        revision = self.revision(board)
        return {"board": str(self.path), "socket": self.socket,
                "kicad": str(self.api.get_version()), "revision": revision,
                "footprints": len(board.get_footprints()),
                "undo_available": bool(self.undo_stack and self.undo_stack[-1][1] == revision),
                "redo_available": bool(self.redo_stack and self.redo_stack[-1][0] == revision)}

    def inspect(self, references):
        if not 1 <= len(references) <= 32:
            raise ValueError("Inspect 1 to 32 references at a time.")
        board = self.board()
        revision = self.revision(board)
        parts = self.parts(board)
        return {"revision": revision, "parts": [self.describe(parts[ref]) for ref in references]}

    def part_labels(self):
        board = self.board()
        revision = self.revision(board)
        parts = self.parts(board)
        bounds = board.get_item_bounding_box(list(parts.values()), include_text=False)
        result = []
        for (ref, part), box in zip(parts.items(), bounds, strict=True):
            if box is None:
                continue
            nets = {pad.net.name for pad in part.definition.pads}
            result.append({
                "ref": ref,
                "value": part.value_field.text.value,
                "position": [part.position.x / 1e6, part.position.y / 1e6],
                "angle": part.orientation.degrees % 360,
                "bounds": [box.pos.x / 1e6, box.pos.y / 1e6, box.size.x / 1e6, box.size.y / 1e6],
                "nets": sorted(net.replace("{slash}", "/") for net in nets
                               if net and not net.startswith("unconnected-")),
            })
        outline = [item for item in board.get_shapes() if item.layer == BoardLayer.BL_Edge_Cuts]
        extents = board.get_item_bounding_box(outline, include_text=False) if outline else bounds
        occupied = [box for box in extents if box is not None]
        origin = [min((getattr(box.pos, axis) for box in occupied), default=0) / 1e6
                  for axis in ("x", "y")]
        return {"revision": revision, "origin": origin, "parts": result}

    def move(self, placements, expected_revision, label):
        if not 1 <= len(placements) <= 16:
            raise ValueError("Move 1 to 16 footprints in one patch.")
        if len({p.reference for p in placements}) != len(placements):
            raise ValueError("Duplicate references in the move.")
        board = self.checked(expected_revision)
        parts = self.parts(board)
        updates, before = [], []
        for place in placements:
            part = parts[place.reference]
            if part.locked:
                raise ValueError(f"{place.reference} is locked.")
            before.append(self.describe(part))
            part.position = Vector2.from_xy(round(place.x_mm * 1e6), round(place.y_mm * 1e6))
            updates.append(part)
        if all((p.position.x, p.position.y) ==
               (round(old['x_mm'] * 1e6), round(old['y_mm'] * 1e6))
               for p, old in zip(updates, before)):
            return {"changed": False, "revision": expected_revision}
        commit = board.begin_commit()
        try:
            result = board.update_items(updates)
            if len(result) != len(updates):
                raise RuntimeError("KiCad did not stage every requested footprint.")
        except BaseException:
            board.drop_commit(commit)
            raise
        board.push_commit(commit, "dogbone: " + label[:80])
        revision = self.revision(board)
        self.undo_stack.append((expected_revision, revision))
        self.redo_stack.clear()
        actual = self.parts(board)
        after = [self.describe(actual[p.reference]) for p in placements]
        for requested, observed in zip(placements, after):
            if (round(observed['x_mm'] * 1e6), round(observed['y_mm'] * 1e6)) != (
                    round(requested.x_mm * 1e6), round(requested.y_mm * 1e6)):
                raise RuntimeError("Move verification failed; inspect before continuing.")
        return {"changed": True, "revision": revision, "before": before, "after": after,
                "saved": False, "undo_steps": 1}

    def history(self, expected_revision, redo=False):
        board = self.checked(expected_revision)
        source = self.redo_stack if redo else self.undo_stack
        target = self.undo_stack if redo else self.redo_stack
        if not source:
            raise ValueError("No connector edit to redo." if redo else "No connector edit to undo.")
        before, after = source[-1]
        wanted, current = (after, before) if redo else (before, after)
        if expected_revision != current:
            raise ValueError("History diverged; refusing to undo another edit.")
        self.api.run_action("common.Interactive.redo" if redo else "common.Interactive.undo")
        deadline = monotonic() + 3
        while True:
            revision = self.revision(board)
            if revision == wanted:
                source.pop()
                target.append((before, after))
                return {"revision": revision, "native": True, "saved": False}
            if monotonic() > deadline:
                self.undo_stack.clear()
                self.redo_stack.clear()
                raise RuntimeError("Native history did not reach the expected state; stopped. Inspect the board.")
            sleep(0.05)

    def focus(self, references):
        if not 1 <= len(references) <= 32:
            raise ValueError("Focus 1 to 32 references at a time.")
        board = self.board()
        parts = self.parts(board)
        selection = [parts[ref] for ref in references]
        board.clear_selection()
        try:
            board.add_to_selection(selection)
            self.api.run_action("common.Control.zoomFitSelection")
        finally:
            board.clear_selection()
        return {"focused": references}

    def save(self, expected_revision):
        board = self.checked(expected_revision)
        board.save()
        return {"saved": True, "board": str(self.path), "revision": self.revision(board)}


def make_server(connector):
    server = FastMCP("dogbone", instructions=(
        "Work on the configured open PCB only. Inspect named references first. "
        "Use the returned revision for a tiny move. Placement does not drag tracks. "
        "Edits are live and unsaved until kicad_save. One move is one native Undo. "
        "Undo/Redo only operate on this connector process's edits and refuse diverged states. "
        "Do not retry a timed-out mutation: inspect first. Never restore files under the editor."))

    def serialized(func):
        @wraps(func)
        def wrapped(*args, **kwargs):
            with connector.lock:
                return func(*args, **kwargs)
        return wrapped

    @server.tool()
    @serialized
    def kicad_status() -> dict:
        """Check the configured live board and obtain its current revision."""
        return connector.status()

    @server.tool()
    @serialized
    def kicad_inspect(references: list[str]) -> dict:
        """Read positions in mm, angles and locks for 1-32 named footprints."""
        return connector.inspect(references)

    @server.tool()
    @serialized
    def kicad_move(placements: list[Placement], expected_revision: str, label: str = "Move footprints") -> dict:
        """Move 1-16 footprints live in one native Undo step. Tracks stay in place. Does not save."""
        return connector.move(placements, expected_revision, label)

    @server.tool()
    @serialized
    def kicad_undo(expected_revision: str) -> dict:
        """Native Undo of the connector's last edit, only if the live board still matches it."""
        return connector.history(expected_revision)

    @server.tool()
    @serialized
    def kicad_redo(expected_revision: str) -> dict:
        """Native Redo of the connector's last undone edit, with full-board verification."""
        return connector.history(expected_revision, redo=True)

    @server.tool()
    @serialized
    def kicad_focus(references: list[str]) -> dict:
        """Frame named footprints in the existing PCB Editor. Does not open windows or edit."""
        return connector.focus(references)

    @server.tool()
    @serialized
    def kicad_save(expected_revision: str) -> dict:
        """Explicitly save the verified live board to its existing file."""
        return connector.save(expected_revision)

    return server

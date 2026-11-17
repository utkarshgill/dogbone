"""Read footprint labels using the Python interpreter that ships with KiCad."""
import json
import sys


def read_parts(path):
    import pcbnew

    board = pcbnew.LoadBoard(path)
    parts = []
    for fp in board.GetFootprints():
        box = fp.GetBoundingBox(False, False)
        position = fp.GetPosition()
        nets = {p.GetNetname() for p in fp.Pads()}
        parts.append({
            "ref": fp.GetReference(),
            "value": fp.GetValue(),
            "position": [position.x / 1e6, position.y / 1e6],
            "angle": fp.GetOrientationDegrees() % 360,
            "bounds": [v / 1e6 for v in (box.GetX(), box.GetY(), box.GetWidth(), box.GetHeight())],
            "nets": sorted(n.replace("{slash}", "/") for n in nets
                           if n and not n.startswith("unconnected-")),
        })
    edge = board.GetBoardEdgesBoundingBox()
    origin = [edge.GetX() / 1e6, edge.GetY() / 1e6]
    if not (edge.GetWidth() or edge.GetHeight()):
        origin = [min((p["bounds"][axis] for p in parts), default=0) for axis in (0, 1)]
    return {"origin": origin, "parts": parts}


if __name__ == "__main__":
    print(json.dumps(read_parts(sys.argv[1])))

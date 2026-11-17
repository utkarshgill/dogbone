# DOGBONE

move parts in kicad from Codex or Claude Code. watch it happen in your browser.
dogbone runs on localhost. no dogbone signup.

<p>
  <img src="docs/board.jpg" alt="2D board view" width="49%">
  <img src="docs/3d.jpg" alt="3D board view" width="49%">
</p>

python 3.10+. kicad 10 with the ipc api enabled.

```sh
git clone --recurse-submodules https://github.com/utkarshgill/dogbone.git
cd dogbone
python3 -m venv .venv
.venv/bin/pip install .
# open examples/pcbgolf/work/pcbgolf.kicad_pcb in kicad
.venv/bin/python -m dogbone --board examples/pcbgolf/work/pcbgolf.kicad_pcb --replay examples/pcbgolf/replay.json
```

open [the viewer](http://localhost:4083/). in another terminal, pick one.

```sh
codex mcp add dogbone --url http://127.0.0.1:4083/mcp
claude mcp add --transport http dogbone http://127.0.0.1:4083/mcp
```

start your agent in this folder. try `Move SW1 2 mm left with dogbone.` then `Undo it.`

Replay animates four saved PCBGolf placements in the browser. It leaves the open board alone.

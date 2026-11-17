# dogbone

your agent moves parts in kicad. you watch in the browser.
same agent, same harness.

python 3.10+ and kicad 10.

```sh
git submodule update --init
python3 -m venv .venv
.venv/bin/pip install .
```

open `examples/pcbgolf/pcbgolf.kicad_pcb` in kicad. enable the ipc api in preferences.

```sh
.venv/bin/python -m dogbone --board examples/pcbgolf/pcbgolf.kicad_pcb
```

browser `http://localhost:4083/`
mcp (streamable http) `http://127.0.0.1:4083/mcp`

board is 2d. 3d loads when you click it. fit resets the view.

inspect a ref. move it. undo if it's ugly. save when it isn't.
placement only for now.

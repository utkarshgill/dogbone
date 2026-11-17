# dogbone

your agent moves parts in kicad. you watch in the browser.
same agent, same harness.

python 3.10+ and kicad 10.

```sh
git clone --recurse-submodules https://github.com/utkarshgill/dogbone.git
cd dogbone
python3 -m venv .venv
.venv/bin/pip install .
```

under `examples/pcbgolf`, `upstream` is comma's board. `work` is our layout.

open `examples/pcbgolf/work/pcbgolf.kicad_pcb` in kicad. enable the ipc api in preferences.

```sh
.venv/bin/python -m dogbone --board examples/pcbgolf/work/pcbgolf.kicad_pcb
```

browser `http://localhost:4083/`
mcp (streamable http) `http://127.0.0.1:4083/mcp`

add that mcp url to the agent you already use. its mcp client needs to reach localhost.

board is 2d. 3d loads when you click it. fit resets the view.
pick a part under components or click the board. properties are on the right.
labels puts the reference on the board in either view.
put `<board>.labels.json` next to the board for part names and descriptions.

inspect a ref. move it. undo if it's ugly. save when it isn't.
placement only for now.

![board view with part labels](docs/board.jpg)

![3d view with part labels](docs/3d.jpg)

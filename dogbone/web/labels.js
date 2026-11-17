const svgNS = "http://www.w3.org/2000/svg";
const svg = (tag, attrs) => {
  const node = document.createElementNS(svgNS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
};

export function createLabels(canvas) {
  const toggle = document.querySelector("#labels-toggle");
  const overlay = document.querySelector("#labels");
  const components = document.querySelector("#components");
  const picker = document.querySelector("#part-picker");
  const detail = document.querySelector("#part-detail");
  const fields = document.querySelector("#part-fields");
  const modelMark = document.querySelector("#model-mark");
  const tag = document.querySelector("#model-label");
  const targets = svg("g", {});
  const outline = svg("rect", {class: "part-outline", "pointer-events": "none"});
  const caption = svg("text", {class: "part-caption", "pointer-events": "none"});
  overlay.append(targets, outline, caption);

  let enabled = false, is3d = false, selected, frame, data, pending, viewBox;
  let model, modelRevision, pointerStart;
  const rows = new Map();
  const find = ref => data?.parts.find(part => part.ref === ref);
  const sameRevision = () => data && `"${data.revision}"` === frame?.etag;
  const modelReady = () => sameRevision() && frame.etag === modelRevision;

  function bounds(part) {
    const [x,y,width,height] = part.bounds;
    return {x:x-data.origin[0]+viewBox[0], y:y-data.origin[1]+viewBox[1], width, height};
  }

  function drawTag() {
    const rect = is3d && modelReady() && selected ? model.locate(selected) : null;
    modelMark.hidden = !rect;
    if (!rect) return;
    tag.hidden = !enabled;
    tag.textContent = selected.ref;
    for (const [key,value] of Object.entries({left:rect[0],top:rect[1],width:rect[2],height:rect[3]})) {
      modelMark.style[key] = `${value}%`;
    }
  }

  function highlight() {
    const part = sameRevision() ? selected : null;
    outline.setAttribute("visibility", part && !is3d ? "visible" : "hidden");
    caption.setAttribute("visibility", part && enabled && !is3d ? "visible" : "hidden");
    if (part && viewBox && !is3d) {
      const b = bounds(part);
      for (const [key,value] of Object.entries(b)) outline.setAttribute(key,value);
      caption.setAttribute("x", b.x);
      caption.setAttribute("y", Math.max(viewBox[1]+2,b.y-.5));
      caption.textContent = part.ref;
    }
    drawTag();
  }

  function select(part) {
    rows.get(selected?.ref)?.setAttribute("aria-pressed","false");
    selected = part;
    picker.value = part?.ref || "";
    detail.textContent = part ? [
      part.name || part.value, part.description,
    ].filter(Boolean).join(" · ") : "Select a part.";
    fields.replaceChildren();
    fields.hidden = !part;
    if (part) {
      const row = rows.get(part.ref);
      if (row) {
        row.setAttribute("aria-pressed","true");
        row.closest("details").open = true;
        row.scrollIntoView({block:"nearest"});
      }
      for (const [key,value] of [
        ["Reference",part.ref], ["Value",part.value], ["Group",part.group],
        ["Position",part.position.map(n => n.toFixed(2)).join(", ")+" mm"],
        ["Rotation",part.angle+"°"], ["Signals",part.nets.join(" · ")],
      ]) {
        if (!value) continue;
        const name = document.createElement("dt");
        const field = document.createElement("dd");
        name.textContent = key;
        field.textContent = value;
        fields.append(name,field);
      }
    }
    highlight();
  }

  function populate() {
    const first = new Option("Select a part", "");
    const groups = new Map();
    const sections = new Map();
    rows.clear();
    for (const part of data.parts.sort((a,b) => a.ref.localeCompare(b.ref,"en",{numeric:true}))) {
      const group = part.group || "Footprints";
      if (!groups.has(group)) {
        const item = document.createElement("optgroup");
        item.label = group;
        groups.set(group,item);
        const section = document.createElement("details");
        const title = document.createElement("summary");
        title.textContent = group;
        section.append(title);
        sections.set(group,section);
      }
      groups.get(group).append(new Option(`${part.ref} · ${part.name || part.value}`,part.ref));
      const row = document.createElement("button");
      row.type = "button";
      row.className = "component";
      row.textContent = `${part.ref} · ${part.name || part.value}`;
      row.setAttribute("aria-pressed","false");
      row.onclick = () => select(part);
      sections.get(group).append(row);
      rows.set(part.ref,row);
    }
    picker.replaceChildren(first,...groups.values());
    components.replaceChildren(...sections.values());
    const area = p => p.bounds[2]*p.bounds[3];
    targets.replaceChildren(...[...data.parts].sort((a,b) => area(b)-area(a))
      .map(part => svg("rect", {...bounds(part), "data-ref":part.ref, class:"part-target"})));
    select(find(selected?.ref));
  }

  async function refresh() {
    if (!frame || sameRevision() || pending) return;
    const request = frame;
    pending = true;
    try {
      const response = await fetch("/parts.json");
      if (!response.ok) throw new Error("Could not read footprints");
      const result = await response.json();
      if (`"${result.revision}"` !== frame.etag) return;
      const current = frame;
      const parsed = new DOMParser().parseFromString(await current.blob.text(), "image/svg+xml");
      if (current !== frame) return;
      data = result;
      const box = parsed.documentElement.getAttribute("viewBox");
      viewBox = box.trim().split(/\s+/).map(Number);
      overlay.setAttribute("viewBox",box);
      populate();
    } catch {
      detail.textContent = "Part labels need the board open in KiCad.";
    } finally {
      pending = false;
      if (frame !== request) refresh();
    }
  }

  function show() {
    toggle.setAttribute("aria-pressed",enabled);
    overlay.toggleAttribute("hidden", is3d);
    refresh();
    highlight();
  }

  toggle.onclick = () => { enabled = !enabled; show(); };
  picker.onchange = () => select(find(picker.value));
  overlay.addEventListener("click", event => {
    if (sameRevision() && event.target.dataset.ref) select(find(event.target.dataset.ref));
  });
  canvas.addEventListener("pointerdown", event => {
    pointerStart = [event.clientX,event.clientY];
  });
  canvas.addEventListener("pointerup", event => {
    if (is3d && modelReady() && pointerStart &&
        Math.hypot(event.clientX-pointerStart[0],event.clientY-pointerStart[1]) < 4) {
      const part = model.pick(event.clientX,event.clientY,data.parts);
      if (part) select(part);
    }
    pointerStart = null;
  });
  return {
    view: mode => { is3d = mode; show(); },
    frame: (etag,blob) => {
      if (frame?.etag === etag) return;
      frame = {etag,blob};
      targets.replaceChildren();
      highlight();
      refresh();
    },
    model: (viewer,etag) => {
      model = viewer;
      modelRevision = etag;
      viewer.onDraw(drawTag);
      highlight();
    },
  };
}

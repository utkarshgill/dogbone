const svgNS = "http://www.w3.org/2000/svg";
const svg = (tag, attrs) => {
  const node = document.createElementNS(svgNS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
};

export function createLabels(canvas, onParts) {
  const overlay = document.querySelector("#labels");
  const components = document.querySelector("#components");
  const detail = document.querySelector("#part-detail");
  const fields = document.querySelector("#part-fields");
  const previewPanel = document.querySelector("#footprint-preview");
  const preview = previewPanel.querySelector("img");
  preview.onload = () => { previewPanel.hidden = false; };
  preview.onerror = () => { previewPanel.hidden = true; };
  const modelMark = document.querySelector("#model-mark");
  const tag = document.querySelector("#model-label");
  const targets = svg("g", {});
  const outline = svg("rect", {class: "part-outline", "pointer-events": "none"});
  const caption = svg("text", {class: "part-caption", "pointer-events": "none"});
  overlay.append(targets, outline, caption);

  let is3d = false, selected, frame, data, pending, viewBox;
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
    tag.textContent = selected.ref;
    for (const [key,value] of Object.entries({left:rect[0],top:rect[1],width:rect[2],height:rect[3]})) {
      modelMark.style[key] = `${value}%`;
    }
  }

  function highlight() {
    const part = sameRevision() ? selected : null;
    const visibility = part && !is3d ? "visible" : "hidden";
    outline.setAttribute("visibility", visibility);
    caption.setAttribute("visibility", visibility);
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
    detail.textContent = part ? [
      part.name || part.value, part.description,
    ].filter(Boolean).join(" · ") : "Select a part.";
    fields.replaceChildren();
    fields.hidden = !part;
    if (!part) {
      previewPanel.hidden = true;
      preview.removeAttribute("src");
    } else {
      const source = `/footprint.svg?ref=${encodeURIComponent(part.ref)}&revision=${data.revision}`;
      if (preview.getAttribute("src") !== source) {
        if (preview.dataset.ref !== part.ref) previewPanel.hidden = true;
        preview.dataset.ref = part.ref;
        preview.alt = `${part.ref} KiCad footprint`;
        preview.style.transform = `rotate(${-part.angle}deg)`;
        preview.src = source;
      }
    }
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
    const sections = new Map();
    rows.clear();
    for (const part of data.parts.sort((a,b) => a.ref.localeCompare(b.ref,"en",{numeric:true}))) {
      const group = part.group || "Footprints";
      if (!sections.has(group)) {
        const section = document.createElement("details");
        const title = document.createElement("summary");
        title.textContent = group;
        section.append(title);
        sections.set(group,section);
      }
      const row = document.createElement("button");
      row.type = "button";
      row.className = "component";
      const ref = document.createElement("span");
      const name = document.createElement("span");
      ref.textContent = part.ref;
      name.textContent = part.name || part.value;
      row.append(ref,name);
      row.setAttribute("aria-pressed","false");
      row.onclick = () => select(part);
      sections.get(group).append(row);
      rows.set(part.ref,row);
    }
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
      const previous = data;
      data = result;
      const box = frame.viewBox;
      viewBox = box.trim().split(/\s+/).map(Number);
      overlay.setAttribute("viewBox",box);
      populate();
      onParts(previous, data);
    } catch {
      detail.textContent = "Part labels unavailable.";
    } finally {
      pending = false;
      if (frame !== request) refresh();
    }
  }

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
    view: mode => {
      is3d = mode;
      overlay.toggleAttribute("hidden", is3d);
      refresh();
      highlight();
    },
    frame: (etag,viewBox) => {
      if (frame?.etag === etag) return;
      frame = {etag,viewBox};
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

import {animate} from "./motion.js";

export async function exportVideo(drawFrame, duration, signal, progress) {
  if (signal.aborted) return;
  const canvas = document.createElement("canvas");
  const width = canvas.width = 1280, height = canvas.height = 720;
  const ctx = canvas.getContext("2d"), fps = 30;
  const mimeType = ["video/mp4;codecs=avc1.42001f", "video/webm;codecs=vp9", "video/webm"]
    .find(type => MediaRecorder.isTypeSupported(type));
  const stream = canvas.captureStream(fps);
  let frame = -1;
  function paint(p) {
    const next = Math.floor(p * duration * fps);
    if (frame === next) return;
    frame = next;
    const caption = drawFrame(ctx, width, height, frame / fps);
    ctx.fillStyle = "#aceabd";
    ctx.font = "600 20px monospace";
    ctx.fillText("DOGBONE / PLACEMENT REPLAY", 30, 42);
    ctx.fillStyle = "#c6dbce";
    ctx.font = "16px monospace";
    ctx.fillText(caption, 30, height - 24);
    ctx.fillStyle = "#aceabd";
    ctx.fillRect(0, height - 3, width * p, 3);
    progress(p);
  }

  const chunks = [];
  let recorder, cancel;
  try {
    recorder = new MediaRecorder(stream, {mimeType, videoBitsPerSecond: 5_000_000});
    await new Promise((resolve, reject) => {
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = event => reject(event.error);
      recorder.onstop = resolve;
      signal.addEventListener("abort", stop, {once: true});
      paint(0);
      recorder.start();
      cancel = animate(duration * 1000, paint, stop);
    });
    if (signal.aborted) return;
    if (!chunks.length) throw new Error("The browser produced an empty video");
    const url = URL.createObjectURL(new Blob(chunks, {type: recorder.mimeType}));
    const download = document.createElement("a");
    download.href = url;
    download.download = "dogbone-placement-replay." + (recorder.mimeType.includes("mp4") ? "mp4" : "webm");
    download.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  } finally {
    stop();
    signal.removeEventListener("abort", stop);
    stream.getTracks().forEach(track => track.stop());
  }
  function stop() {
    cancel?.();
    if (recorder?.state === "recording") recorder.stop();
  }
}

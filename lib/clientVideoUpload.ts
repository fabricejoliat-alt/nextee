"use client";

function waitForVideo(video: HTMLVideoElement) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("Video unavailable")), 15000);
    function finish(error?: Error) {
      clearTimeout(timer);
      video.onloadeddata = null;
      video.onerror = null;
      if (error) reject(error);
      else resolve();
    }
    video.onloadeddata = () => finish();
    video.onerror = () => finish(new Error("Video unavailable"));
  });
}

/** Re-encode locally. Unsupported codecs, interrupted playback and larger outputs keep the original. */
export async function optimizeVideoUpload(file: File, onProgress: (percent: number) => void = () => {}) {
  if (typeof MediaRecorder === "undefined" || typeof AudioContext === "undefined") return file;
  const mimeType = ["video/mp4", "video/webm;codecs=vp8,opus"].find(type => MediaRecorder.isTypeSupported(type));
  if (!mimeType) return file;

  const video = document.createElement("video");
  const canvas = document.createElement("canvas");
  if (!canvas.captureStream) return file;
  const url = URL.createObjectURL(file);
  let audio: AudioContext | undefined;
  let stream: MediaStream | undefined;
  let recorder: MediaRecorder | undefined;
  let frame = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let removeVisibilityListener = () => {};
  let resumeTimeout: ReturnType<typeof setTimeout> | undefined;
  try {
    // Start inside the upload button's user gesture so mobile audio can be preserved.
    audio = new AudioContext();
    const resumed = Promise.race([
      audio.resume(),
      new Promise<never>((_, reject) => {
        resumeTimeout = setTimeout(() => reject(new Error("Audio unavailable")), 2000);
      }),
    ]);
    video.playsInline = true;
    video.preload = "auto";
    video.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none";
    video.setAttribute("aria-hidden", "true");
    document.body.append(video);
    const loaded = waitForVideo(video);
    video.src = url;
    await Promise.all([loaded, resumed]);
    if (audio.state !== "running" || !Number.isFinite(video.duration) || video.duration <= 0) return file;
    const scale = Math.min(1, 1920 / Math.max(video.videoWidth, video.videoHeight),
      1080 / Math.min(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(2, Math.floor(video.videoWidth * scale / 2) * 2);
    canvas.height = Math.max(2, Math.floor(video.videoHeight * scale / 2) * 2);
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    stream = canvas.captureStream(60);
    const source = audio.createMediaElementSource(video);
    const destination = audio.createMediaStreamDestination();
    source.connect(destination);
    destination.stream.getAudioTracks().forEach(track => stream!.addTrack(track));
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000, audioBitsPerSecond: 96_000 });
    const activeRecorder = recorder;
    const chunks: Blob[] = [];
    const blob = await new Promise<Blob>((resolve, reject) => {
      let size = 0;
      let lastPercent = -1;
      function fail() { reject(new Error("Video optimization interrupted")); }
      function draw() {
        try {
          context!.drawImage(video, 0, 0, canvas.width, canvas.height);
          const percent = Math.min(99, Math.floor(video.currentTime / video.duration * 100));
          if (percent !== lastPercent) { lastPercent = percent; onProgress(percent); }
          frame = requestAnimationFrame(draw);
        } catch { fail(); }
      }
      function visibilityChanged() {
        if (document.hidden) fail();
      }
      document.addEventListener("visibilitychange", visibilityChanged);
      removeVisibilityListener = () => document.removeEventListener("visibilitychange", visibilityChanged);
      activeRecorder.ondataavailable = event => {
        if (event.data.size) chunks.push(event.data);
        size += event.data.size;
        if (size >= file.size) fail();
      };
      activeRecorder.onerror = () => { removeVisibilityListener(); fail(); };
      activeRecorder.onstop = () => {
        removeVisibilityListener();
        if (!video.ended) { fail(); return; }
        resolve(new Blob(chunks, { type: activeRecorder.mimeType.split(";")[0] }));
      };
      video.onerror = fail;
      video.onended = () => {
        cancelAnimationFrame(frame);
        if (activeRecorder.state !== "inactive") activeRecorder.stop();
      };
      timeout = setTimeout(fail, video.duration * 2000 + 15000);
      activeRecorder.start(1000);
      draw();
      void video.play().catch(fail);
      video.onabort = fail;
    });
    if (!blob.size || blob.size >= file.size * 0.95) return file;
    onProgress(100);
    const extension = blob.type === "video/mp4" ? "mp4" : "webm";
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + "." + extension,
      { type: blob.type, lastModified: file.lastModified });
  } catch {
    return file;
  } finally {
    removeVisibilityListener();
    clearTimeout(timeout);
    clearTimeout(resumeTimeout);
    cancelAnimationFrame(frame);
    if (recorder?.state !== undefined && recorder.state !== "inactive") recorder.stop();
    stream?.getTracks().forEach(track => track.stop());
    video.onended = null;
    video.onerror = null;
    video.onabort = null;
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.remove();
    URL.revokeObjectURL(url);
    if (audio) void audio.close().catch(() => {});
  }
}

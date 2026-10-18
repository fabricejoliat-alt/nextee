/** Read only enough bytes to validate media without waiting for stream cancellation. */
export async function readUploadedDocumentPrefix(signedUrl: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(signedUrl, {
      headers: { Range: "bytes=0-511" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok || !response.body) throw new Error("Unable to inspect uploaded object");
    const reader = response.body.getReader();
    const bytes = new Uint8Array(512);
    let length = 0;
    try {
      while (length < bytes.length) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        const chunk = value.subarray(0, bytes.length - length);
        bytes.set(chunk, length);
        length += chunk.length;
      }
      return bytes.slice(0, length);
    } finally {
      // A cloned/tee'd response may wait for the other reader on cancel().
      // Abort the request and do not hold document finalization on that promise.
      void reader.cancel().catch(() => undefined);
    }
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

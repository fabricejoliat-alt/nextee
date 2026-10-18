export type DocumentUploadProgress = {
  phase: "preparing" | "uploading" | "finalizing" | "complete" | "error";
  percent: number;
  error?: string;
};

/** Send the validated MIME type even when a mobile File has an empty/generic type. */
export function uploadDocumentWithProgress(
  signedUrl: string,
  file: File,
  mimeType: string,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", signedUrl);
    request.setRequestHeader("Content-Type", mimeType);
    request.setRequestHeader("x-upsert", "false");
    request.setRequestHeader("cache-control", "max-age=3600");
    request.timeout = 20 * 60 * 1000;
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(100, Math.round(event.loaded / event.total * 100)));
      }
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(100);
        resolve();
        return;
      }
      let message = `Upload failed (HTTP ${request.status})`;
      try {
        const body = JSON.parse(request.responseText);
        message = String(body.message || body.error || message);
      } catch { /* The storage gateway may return a non-JSON error. */ }
      reject(new Error(message));
    };
    request.onerror = () => reject(new Error("Connexion interrompue pendant l’envoi. Vérifiez votre connexion et réessayez."));
    request.ontimeout = () => reject(new Error("L’envoi a pris trop de temps. Vérifiez votre connexion et réessayez."));
    request.onabort = () => reject(new Error("Envoi annulé."));
    request.send(file);
  });
}

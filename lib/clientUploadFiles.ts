"use client";

type OptimizeImageOptions = {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
};

const DEFAULT_OPTIONS: Required<OptimizeImageOptions> = {
  maxWidth: 2000,
  maxHeight: 2000,
  quality: 0.82,
};

function shouldOptimizeImage(file: File) {
  if (!file.type.startsWith("image/")) return false;
  const lower = file.type.toLowerCase();
  if (lower === "image/gif" || lower === "image/svg+xml") return false;
  return true;
}

function loadImageFromFile(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (error) => {
      URL.revokeObjectURL(url);
      reject(error);
    };
    img.src = url;
  });
}

function buildOutputName(fileName: string) {
  const base = fileName.replace(/\.[^.]+$/, "").trim() || "image";
  return `${base}.jpg`;
}

export async function optimizeUploadFile(file: File, options?: OptimizeImageOptions) {
  if (!shouldOptimizeImage(file)) return file;

  const { maxWidth, maxHeight, quality } = { ...DEFAULT_OPTIONS, ...(options ?? {}) };

  try {
    const img = await loadImageFromFile(file);
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (!width || !height) return file;

    const scale = Math.min(1, maxWidth / width, maxHeight / height);
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;

    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((nextBlob) => resolve(nextBlob), "image/jpeg", quality);
    });
    if (!blob) return file;

    const optimized = new File([blob], buildOutputName(file.name), {
      type: "image/jpeg",
      lastModified: Date.now(),
    });

    if (optimized.size >= file.size * 0.95) return file;
    return optimized;
  } catch {
    return file;
  }
}

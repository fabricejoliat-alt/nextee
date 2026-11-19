"use client";

import { optimizeVideoUpload } from "./clientVideoUpload.ts";

type OptimizeImageOptions = {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  onVideoProgress?: (percent: number) => void;
};

const DEFAULT_OPTIONS: Required<Omit<OptimizeImageOptions, "onVideoProgress">> = {
  maxWidth: 2000,
  maxHeight: 2000,
  quality: 0.82,
};

function shouldOptimizeImage(file: File) {
  if (!file.type.startsWith("image/") && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) return false;
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
  if (file.type.startsWith("video/") || /\.(mov|mp4|m4v|webm)$/i.test(file.name)) {
    return optimizeVideoUpload(file, options?.onVideoProgress);
  }
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

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, targetWidth, targetHeight);
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

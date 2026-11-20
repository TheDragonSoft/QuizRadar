/**
 * Cross-platform QR Code decoder for Desktop (Tauri WebView2), Firefox, Chrome,
 * Safari, and Vitest.
 *
 * Uses native `BarcodeDetector` when available and seamlessly falls back to
 * pure-JS `jsQR` via RGBA `ImageData` — works for both live webcam frames
 * (`getUserMedia`) and uploaded QR screenshots/photos without failing on
 * browsers/webviews that omit `BarcodeDetector`.
 */

import jsQR from "jsqr";

interface BarcodeDetectorLike {
  detect(image: ImageBitmapSource): Promise<Array<{ rawValue?: string }>>;
}

export function decodeQrFromRgba(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): string | null {
  if (width <= 0 || height <= 0 || data.length < width * height * 4) {
    return null;
  }
  const result = jsQR(data, width, height, { inversionAttempts: "attemptBoth" });
  const text = result?.data?.trim();
  return text ? text : null;
}

async function loadImageElement(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not decode the selected image file."));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function decodeQrFromImageFile(file: File): Promise<string | null> {
  const DetectorCtor = (
    globalThis as unknown as {
      BarcodeDetector?: new (opts?: { formats?: string[] }) => BarcodeDetectorLike;
    }
  ).BarcodeDetector;

  if (DetectorCtor && typeof createImageBitmap !== "undefined") {
    try {
      const detector = new DetectorCtor({ formats: ["qr_code"] });
      const bitmap = await createImageBitmap(file);
      try {
        const codes = await detector.detect(bitmap);
        const rawValue = codes.find((c) => c.rawValue?.trim())?.rawValue?.trim();
        if (rawValue) {
          return rawValue;
        }
      } finally {
        bitmap.close();
      }
    } catch {
      // Fall through to pure-JS jsQR decoding on Canvas.
    }
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("2D canvas context is unavailable for QR image decoding.");
  }

  if (typeof createImageBitmap !== "undefined") {
    const bitmap = await createImageBitmap(file);
    try {
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      ctx.drawImage(bitmap, 0, 0);
    } finally {
      bitmap.close();
    }
  } else {
    const img = await loadImageElement(file);
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    ctx.drawImage(img, 0, 0);
  }

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return decodeQrFromRgba(imageData.data, imageData.width, imageData.height);
}

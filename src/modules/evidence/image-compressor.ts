// ============================================================================
// VERICLAIM MULTI-TENANT SAAS
// MODULE: evidence/image-compressor.ts
// PHASE 5: Investigation Activities, Evidence Pipeline (R2), Versioning, PWA
// ============================================================================

import crypto from 'crypto';

export interface CompressionResult {
  blob: Blob | Buffer;
  fileName: string;
  fileSize: number;
  mimeType: string;
  sha256Hash: string;
  width?: number;
  height?: number;
}

/**
 * Computes SHA-256 hash of a buffer, string, or array buffer
 */
export async function computeSha256(data: Buffer | ArrayBuffer | Uint8Array | string): Promise<string> {
  if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
    let buffer: ArrayBuffer;
    if (typeof data === 'string') {
      buffer = new TextEncoder().encode(data).buffer;
    } else if (data instanceof ArrayBuffer) {
      buffer = data;
    } else {
      buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    }
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Node.js environment
  const hash = crypto.createHash('sha256');
  if (typeof data === 'string') {
    hash.update(data);
  } else if (Buffer.isBuffer(data)) {
    hash.update(data);
  } else {
    hash.update(Buffer.from(data as any));
  }
  return hash.digest('hex');
}

/**
 * Compresses an image file per Rule A8:
 * Max dimension: 1600px, quality: ~0.75 JPEG/WebP.
 */
export async function compressFieldImage(
  file: File | Blob,
  maxDimension = 1600,
  quality = 0.75
): Promise<CompressionResult> {
  if (typeof window === 'undefined') {
    // In Node.js or SSR environment, return original buffer & hash
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const sha256Hash = await computeSha256(buffer);
    return {
      blob: buffer,
      fileName: (file as any).name || 'compressed_evidence.jpg',
      fileSize: buffer.length,
      mimeType: file.type || 'image/jpeg',
      sha256Hash,
    };
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = async () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;

      // Scale proportionally if either dimension exceeds maxDimension
      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas 2D context not available'));
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);

      const targetMime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
      canvas.toBlob(
        async (compressedBlob) => {
          if (!compressedBlob) {
            reject(new Error('Failed to compress image onto canvas'));
            return;
          }

          const arrayBuffer = await compressedBlob.arrayBuffer();
          const sha256Hash = await computeSha256(arrayBuffer);

          resolve({
            blob: compressedBlob,
            fileName: (file as any).name || 'field_evidence.jpg',
            fileSize: compressedBlob.size,
            mimeType: targetMime,
            sha256Hash,
            width,
            height,
          });
        },
        targetMime,
        quality
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image for client compression'));
    };

    img.src = url;
  });
}

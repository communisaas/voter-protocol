/**
 * Browser-safe encoding utilities
 * Replaces Node.js Buffer with native Web APIs
 *
 * Uses native Uint8Array methods (Sept 2025+ browsers) with fallbacks
 */

/**
 * Convert Uint8Array to base64 string
 * Uses native browser API with polyfill fallback
 */
export function uint8ToBase64(bytes: Uint8Array): string {
  // Modern browsers (Chrome 128+, Firefox 128+, Safari 18+)
  if (typeof (bytes as any).toBase64 === 'function') {
    return (bytes as any).toBase64();
  }

  // Fallback: btoa + String.fromCharCode
  const binary = String.fromCharCode(...bytes);
  return btoa(binary);
}

/**
 * Convert base64 string to Uint8Array
 */
export function base64ToUint8(base64: string): Uint8Array {
  // Modern browsers
  if (typeof (Uint8Array as any).fromBase64 === 'function') {
    return (Uint8Array as any).fromBase64(base64);
  }

  // Fallback: atob
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Convert Uint8Array to hex string
 */
export function uint8ToHex(bytes: Uint8Array): string {
  return '0x' + Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert hex string to Uint8Array
 */
export function hexToUint8(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

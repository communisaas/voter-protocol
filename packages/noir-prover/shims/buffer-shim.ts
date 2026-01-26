/**
 * Buffer Shim for Web Workers
 *
 * Provides a minimal Buffer implementation for browser/worker environments.
 * The full 'buffer' package has issues with Vite's worker resolution in dev mode.
 * This shim provides just enough functionality for @aztec/bb.js to work.
 *
 * CRITICAL: This class extends Uint8Array directly, avoiding the Proxy wrapper
 * issues that break typed array operations in Safari/iOS.
 */

type Encoding = 'utf8' | 'utf-8' | 'hex' | 'base64' | 'ascii' | 'binary' | 'latin1';

// @ts-expect-error Custom from() signature provides more flexible type coercion than Uint8Array.from()
class BufferShim extends Uint8Array {
    static isBuffer(obj: unknown): obj is BufferShim {
        return obj instanceof BufferShim;
    }

    static from(
        value: string | ArrayBuffer | ArrayLike<number> | Uint8Array,
        encodingOrOffset?: Encoding | number,
        length?: number
    ): BufferShim {
        if (typeof value === 'string') {
            const encoding = (encodingOrOffset as Encoding) || 'utf8';
            return BufferShim.fromString(value, encoding);
        }
        if (value instanceof ArrayBuffer) {
            const offset = (encodingOrOffset as number) || 0;
            const len = length ?? value.byteLength - offset;
            const arr = new Uint8Array(value, offset, len);
            return new BufferShim(arr);
        }
        if (value instanceof Uint8Array) {
            return new BufferShim(value);
        }
        return new BufferShim(value as ArrayLike<number>);
    }

    static fromString(str: string, encoding: Encoding): BufferShim {
        switch (encoding) {
            case 'hex': {
                const bytes = new Uint8Array(str.length / 2);
                for (let i = 0; i < str.length; i += 2) {
                    bytes[i / 2] = parseInt(str.substring(i, i + 2), 16);
                }
                return new BufferShim(bytes);
            }
            case 'base64': {
                const binary = atob(str);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) {
                    bytes[i] = binary.charCodeAt(i);
                }
                return new BufferShim(bytes);
            }
            case 'utf8':
            case 'utf-8':
            default: {
                const encoder = new TextEncoder();
                return new BufferShim(encoder.encode(str));
            }
        }
    }

    static alloc(size: number, fill?: number | string): BufferShim {
        const buf = new BufferShim(size);
        if (fill !== undefined) {
            const fillVal = typeof fill === 'string' ? fill.charCodeAt(0) : fill;
            buf.fill(fillVal);
        }
        return buf;
    }

    static allocUnsafe(size: number): BufferShim {
        return new BufferShim(size);
    }

    static allocUnsafeSlow(size: number): BufferShim {
        return new BufferShim(size);
    }

    static concat(list: (Uint8Array | BufferShim)[], totalLength?: number): BufferShim {
        const length = totalLength ?? list.reduce((acc, buf) => acc + buf.length, 0);
        const result = new BufferShim(length);
        let offset = 0;
        for (const buf of list) {
            result.set(buf, offset);
            offset += buf.length;
        }
        return result;
    }

    static byteLength(str: string, encoding?: Encoding): number {
        if (encoding === 'hex') {
            return str.length / 2;
        }
        if (encoding === 'base64') {
            return Math.ceil((str.length * 3) / 4);
        }
        return new TextEncoder().encode(str).length;
    }

    toString(encoding?: Encoding): string {
        switch (encoding) {
            case 'hex': {
                return Array.from(this)
                    .map((b) => b.toString(16).padStart(2, '0'))
                    .join('');
            }
            case 'base64': {
                let binary = '';
                for (let i = 0; i < this.length; i++) {
                    binary += String.fromCharCode(this[i]);
                }
                return btoa(binary);
            }
            case 'utf8':
            case 'utf-8':
            default: {
                const decoder = new TextDecoder();
                return decoder.decode(this);
            }
        }
    }

    write(str: string, offset?: number, length?: number, encoding?: Encoding): number {
        const off = offset ?? 0;
        const enc = encoding ?? 'utf8';
        const buf = BufferShim.fromString(str, enc);
        const len = length ?? buf.length;
        const toCopy = Math.min(len, buf.length, this.length - off);
        this.set(buf.subarray(0, toCopy), off);
        return toCopy;
    }

    copy(target: Uint8Array, targetStart?: number, sourceStart?: number, sourceEnd?: number): number {
        const tStart = targetStart ?? 0;
        const sStart = sourceStart ?? 0;
        const sEnd = sourceEnd ?? this.length;
        const len = Math.min(sEnd - sStart, target.length - tStart);
        target.set(this.subarray(sStart, sStart + len), tStart);
        return len;
    }

    equals(other: Uint8Array): boolean {
        if (this.length !== other.length) return false;
        for (let i = 0; i < this.length; i++) {
            if (this[i] !== other[i]) return false;
        }
        return true;
    }

    compare(other: Uint8Array): number {
        const len = Math.min(this.length, other.length);
        for (let i = 0; i < len; i++) {
            if (this[i] < other[i]) return -1;
            if (this[i] > other[i]) return 1;
        }
        if (this.length < other.length) return -1;
        if (this.length > other.length) return 1;
        return 0;
    }

    readUInt8(offset: number): number {
        return this[offset];
    }

    readUInt16BE(offset: number): number {
        return (this[offset] << 8) | this[offset + 1];
    }

    readUInt16LE(offset: number): number {
        return this[offset] | (this[offset + 1] << 8);
    }

    readUInt32BE(offset: number): number {
        return (
            (this[offset] * 0x1000000 +
                ((this[offset + 1] << 16) | (this[offset + 2] << 8) | this[offset + 3])) >>>
            0
        );
    }

    readUInt32LE(offset: number): number {
        return (
            (this[offset] | (this[offset + 1] << 8) | (this[offset + 2] << 16)) +
            this[offset + 3] * 0x1000000
        );
    }

    readBigUInt64BE(offset: number): bigint {
        const hi = BigInt(this.readUInt32BE(offset));
        const lo = BigInt(this.readUInt32BE(offset + 4));
        return (hi << 32n) | lo;
    }

    readBigUInt64LE(offset: number): bigint {
        const lo = BigInt(this.readUInt32LE(offset));
        const hi = BigInt(this.readUInt32LE(offset + 4));
        return (hi << 32n) | lo;
    }

    writeUInt8(value: number, offset: number): number {
        this[offset] = value & 0xff;
        return offset + 1;
    }

    writeUInt16BE(value: number, offset: number): number {
        this[offset] = (value >>> 8) & 0xff;
        this[offset + 1] = value & 0xff;
        return offset + 2;
    }

    writeUInt16LE(value: number, offset: number): number {
        this[offset] = value & 0xff;
        this[offset + 1] = (value >>> 8) & 0xff;
        return offset + 2;
    }

    writeUInt32BE(value: number, offset: number): number {
        this[offset] = (value >>> 24) & 0xff;
        this[offset + 1] = (value >>> 16) & 0xff;
        this[offset + 2] = (value >>> 8) & 0xff;
        this[offset + 3] = value & 0xff;
        return offset + 4;
    }

    writeUInt32LE(value: number, offset: number): number {
        this[offset] = value & 0xff;
        this[offset + 1] = (value >>> 8) & 0xff;
        this[offset + 2] = (value >>> 16) & 0xff;
        this[offset + 3] = (value >>> 24) & 0xff;
        return offset + 4;
    }

    writeBigUInt64BE(value: bigint, offset: number): number {
        const hi = Number((value >> 32n) & 0xffffffffn);
        const lo = Number(value & 0xffffffffn);
        this.writeUInt32BE(hi, offset);
        this.writeUInt32BE(lo, offset + 4);
        return offset + 8;
    }

    writeBigUInt64LE(value: bigint, offset: number): number {
        const hi = Number((value >> 32n) & 0xffffffffn);
        const lo = Number(value & 0xffffffffn);
        this.writeUInt32LE(lo, offset);
        this.writeUInt32LE(hi, offset + 4);
        return offset + 8;
    }

    slice(start?: number, end?: number): BufferShim {
        return new BufferShim(super.slice(start, end));
    }

    toJSON(): { type: 'Buffer'; data: number[] } {
        return {
            type: 'Buffer',
            data: Array.from(this)
        };
    }
}

export const Buffer = BufferShim;
export default BufferShim;

// Auto-install Buffer globally when this module is imported
if (typeof globalThis !== 'undefined' && !globalThis.Buffer) {
    (globalThis as unknown as { Buffer: typeof BufferShim }).Buffer = BufferShim;
}
if (typeof window !== 'undefined' && !(window as unknown as { Buffer?: typeof BufferShim }).Buffer) {
    (window as unknown as { Buffer: typeof BufferShim }).Buffer = BufferShim;
}

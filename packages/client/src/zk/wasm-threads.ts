// Feature detection for SharedArrayBuffer (required for wasm threads)
// and COOP/COEP headers.

export function supportsSharedArrayBuffer(): boolean {
  // Safari exposes SharedArrayBuffer but blocks without proper headers; test transferability.
  if (typeof SharedArrayBuffer === 'undefined') return false;
  try {
    // Attempt to instantiate and transfer to detect COOP/COEP enabled envs.
    const sab = new SharedArrayBuffer(1);
    const { port1, port2 } = new MessageChannel();
    port1.postMessage(sab, [sab]);
    port2.close();
    port1.close();
    return true;
  } catch {
    return false;
  }
}

export function isWorkerSupported(): boolean {
  return typeof Worker !== 'undefined';
}

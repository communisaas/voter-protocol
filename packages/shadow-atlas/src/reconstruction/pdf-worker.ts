/**
 * PDF parsing worker thread.
 *
 * Isolates PDF parser in a separate thread so that
 * timeout can actually terminate parsing (worker.terminate()),
 * preventing CPU/memory exhaustion from malicious PDFs.
 */
import { parentPort, workerData } from 'node:worker_threads';
import PDFParser from 'pdf2json';

const buffer = Buffer.from(workerData.buffer);
const parser = new PDFParser(null, true); // true = raw text mode

parser.on('pdfParser_dataError', (errData: any) => {
  const message = errData?.parserError?.message ?? String(errData);
  parentPort?.postMessage({ type: 'error', message });
});

parser.on('pdfParser_dataReady', (pdfData: any) => {
  const pages = (pdfData as any).Pages || [];
  const text = pages
    .flatMap((p: any) => (p.Texts || []))
    .map((t: any) => {
      const runs = t.R || [];
      return runs
        .map((r: any) => {
          const token = r.T || '';
          try {
            return decodeURIComponent(token);
          } catch (e) {
            if (e instanceof URIError) return token;
            throw e;
          }
        })
        .join('');
    })
    .join(' ');

  parentPort?.postMessage({
    type: 'result',
    pages: pages.length,
    text,
    meta: (pdfData as any).Meta || {},
  });
});

parser.parseBuffer(buffer);

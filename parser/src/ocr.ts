/**
 * OCR fallback for scanned (image-only) PDFs.
 *
 * Tier 2 of text extraction: when `pdf-parse` returns < 50 chars (a PDF with
 * no embedded text layer, just rasterised images), `parsePdf` calls
 * `extractTextWithOcr(buffer)` to OCR the pixels.
 *
 * Pipeline:
 *   1. Render every PDF page to a PNG Buffer using `pdfjs-dist` + `@napi-rs/canvas`.
 *   2. Pass each PNG to `tesseract.js` (English, PSM 6 = single uniform
 *      block, which suits invoice/statement layouts better than auto).
 *   3. Concatenate per-page text with `\n\n` (matches pdf-parse's multi-page
 *      output convention) so the existing `detect()` and parsers don't need
 *      to care where the text came from.
 *
 * --- Library choice: pdfjs-dist + @napi-rs/canvas over pdf2pic ---
 *
 * `pdf2pic` shells out to GraphicsMagick or ImageMagick — those have to be
 * installed system-wide on every machine that runs the parser (dev laptops,
 * CI, prod containers). That's fragile ops.
 *
 * `pdfjs-dist` is Mozilla's pure-JS PDF renderer. Combined with
 * `@napi-rs/canvas` (prebuilt Canvas binaries — no compile step, no system
 * deps) it can rasterise PDF pages to PNG Buffers in pure Node code with
 * zero system deps. Works identically on Windows / macOS / Linux out of
 * the box.
 *
 * We *almost* used the `pdf-to-png-converter` wrapper (which combines these
 * two libs) but it has a Windows bug: it builds `cMapUrl` using `path.sep`
 * (which is `\` on Windows), but pdfjs treats `cMapUrl` as a URL where the
 * trailing separator must be `/`. So we drive pdfjs directly and pass a
 * forward-slash file URL.
 *
 * --- Library choice: tesseract.js over node-tesseract-ocr ---
 *
 * Same logic — `node-tesseract-ocr` requires the tesseract binary on PATH.
 * `tesseract.js` ships the engine as WASM and works from `npm install`.
 *
 * --- Worker caching ---
 *
 * The tesseract worker is expensive to spin up (loads ~10MB of WASM + the
 * English language data). We cache one module-level worker and reuse it
 * across calls — first OCR pass pays the init cost, subsequent ones are
 * noticeably faster.
 */

import { createRequire } from 'node:module';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createWorker, type Worker, PSM } from 'tesseract.js';

/** Render scale. pdfjs uses 72 DPI = 1.0; 2.0 gives ~144 DPI which is enough
 * for clean printed scans. Bump to 3.0 (216 DPI) or higher if OCR quality
 * suffers on noisier images. */
const RENDER_SCALE = 2.0;

let cachedWorker: Worker | null = null;
let workerInitPromise: Promise<Worker> | null = null;

/** Lazily initialise (and memoise) a single tesseract worker. */
async function getWorker(): Promise<Worker> {
  if (cachedWorker) return cachedWorker;
  if (workerInitPromise) return workerInitPromise;

  workerInitPromise = (async () => {
    const worker = await createWorker('eng');
    // PSM 6 = "Assume a single uniform block of text". Better than the
    // default auto (PSM 3) for invoice/statement layouts where the whole
    // page is one structured block. If real-world scans come back garbled
    // try PSM 4 (single column) or PSM 11 (sparse text).
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
    });
    cachedWorker = worker;
    return worker;
  })();

  return workerInitPromise;
}

/**
 * Resolve the bundled pdfjs-dist resources to URLs pdfjs can consume.
 *
 * pdfjs-dist 5.x is ESM-only, but it's installed locally so we can reach
 * its on-disk asset directories. cMapUrl and standardFontDataUrl have to be
 * URLs (file://) with trailing slashes — Windows path separators don't work.
 */
function getPdfjsResourcePaths(): { cMapUrl: string; standardFontDataUrl: string } {
  // createRequire lets us resolve from a known anchor regardless of cwd.
  const requireFromHere = createRequire(import.meta.url);
  const pdfjsPkg = requireFromHere.resolve('pdfjs-dist/package.json');
  // strip "/package.json" off the end to get the package root.
  const pdfjsRoot = resolve(pdfjsPkg, '..');

  // pathToFileURL gives a forward-slash file:// URL. Append a trailing slash
  // so pdfjs treats it as a directory.
  const cmapUrl = pathToFileURL(`${pdfjsRoot}${sep}cmaps${sep}`).href;
  const fontUrl = pathToFileURL(`${pdfjsRoot}${sep}standard_fonts${sep}`).href;

  return { cMapUrl: cmapUrl, standardFontDataUrl: fontUrl };
}

/**
 * Render every page of a PDF to a PNG Buffer.
 *
 * Uses pdfjs-dist to parse and rasterise; uses @napi-rs/canvas as the Canvas
 * implementation pdfjs renders into; reads back the page as a PNG Buffer.
 */
async function renderPdfPagesToPng(buffer: Buffer): Promise<Buffer[]> {
  // Dynamic import because pdfjs-dist 5.x is ESM-only and we don't want to
  // pay the import cost unless OCR is actually needed.
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

  // Point pdfjs at its bundled worker file. In Node, pdfjs would otherwise
  // try to spawn a "fake worker" by fetching a worker URL — which fails
  // outside a browser. Pointing workerSrc at the real worker .mjs (as a
  // file:// URL) lets pdfjs run the worker code directly.
  const requireFromHere = createRequire(import.meta.url);
  const pdfjsPkgPath = requireFromHere.resolve('pdfjs-dist/package.json');
  const pdfjsRoot = resolve(pdfjsPkgPath, '..');
  pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(
    `${pdfjsRoot}${sep}legacy${sep}build${sep}pdf.worker.mjs`
  ).href;

  // Lazy require so we get a clear error if @napi-rs/canvas didn't install
  // its native binding. pdfjs-dist declares it as an optional dep.
  const { createCanvas } = requireFromHere(
    '@napi-rs/canvas'
  ) as typeof import('@napi-rs/canvas');

  const { cMapUrl, standardFontDataUrl } = getPdfjsResourcePaths();

  // Convert Node Buffer to Uint8Array. Don't pass the Buffer's underlying
  // ArrayBuffer directly — pdfjs takes ownership and Node's pooled Buffer
  // can detach it, breaking unrelated callers.
  const data = new Uint8Array(buffer);

  const loadingTask = pdfjsLib.getDocument({
    data,
    cMapUrl,
    cMapPacked: true,
    standardFontDataUrl,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  const pdfDoc = await loadingTask.promise;

  const pngs: Buffer[] = [];

  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const width = Math.ceil(viewport.width);
    const height = Math.ceil(viewport.height);

    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    // White background — many scans default to white paper; ensures
    // transparent canvas pixels don't confuse OCR.
    context.fillStyle = 'white';
    context.fillRect(0, 0, width, height);

    await page.render({
      // pdfjs accepts either `canvas` or `canvasContext`; types want a DOM
      // Canvas. @napi-rs/canvas is API-compatible enough at runtime.
      canvas: canvas as unknown as HTMLCanvasElement,
      viewport,
    }).promise;

    pngs.push(canvas.toBuffer('image/png'));
    page.cleanup();
  }

  await pdfDoc.cleanup();
  await pdfDoc.destroy();

  return pngs;
}

/**
 * Extract text from a (likely image-only) PDF using OCR.
 *
 * Returns plain text with `\n\n` between pages, matching pdf-parse's output
 * shape so downstream `detect()` and parsers don't need to care about the
 * source.
 */
export async function extractTextWithOcr(buffer: Buffer): Promise<string> {
  const pngs = await renderPdfPagesToPng(buffer);
  const worker = await getWorker();

  const pageTexts: string[] = [];
  for (const png of pngs) {
    const { data } = await worker.recognize(png);
    pageTexts.push(data.text);
  }

  return pageTexts.join('\n\n');
}

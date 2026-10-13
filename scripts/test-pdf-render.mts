import assert from 'node:assert/strict';
import { renderPdfPagesToPng } from '../parser/src/ocr.ts';
// A generated, non-customer PDF exercises the upgraded PDF.js/native renderer.
const stream='BT /F1 12 Tf 40 150 Td (Synthetic receipt 123) Tj ET';
const objects=[
 '<< /Type /Catalog /Pages 2 0 R >>',
 '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
 '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
 '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
 `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
];
let text='%PDF-1.4\n';const offsets=[0];
for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(text));text+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
const xref=Buffer.byteLength(text);text+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
const pngs=await renderPdfPagesToPng(Buffer.from(text));
assert.equal(pngs.length,1);assert.equal(pngs[0].subarray(1,4).toString(),'PNG');
console.log('PDF rendering smoke test passed with synthetic document.');

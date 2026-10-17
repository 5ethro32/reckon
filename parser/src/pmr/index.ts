/** Dispensing system (PMR) exports, without the PDF stack: `@reckon/parser/pmr`. */
export { parsePslXlsx as parsePmrXlsx, detectPslReport } from './psl';
export { productKey, type ProductKey } from './product-key';
export { looksLikeXlsx } from '../xlsx';
export type { ParsedPmr, PmrReport, PmrDispensingRow, PmrStockRow, PmrPipRow } from '../types/index';

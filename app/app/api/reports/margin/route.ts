import type { NextRequest } from 'next/server';
import { loadMarginRows } from '@/lib/margin-data';
import { lineMarginCsv, productMarginCsv, supplierMarginCsv, type MarginLine, type ProductMargin, type SupplierMargin } from '@/lib/margin-report';
import { parsePeriod } from '@/lib/period';
/** Purchase margin against the Drug Tariff as CSV: ?view=suppliers|products|lines&from=YYYY-MM-DD&to=YYYY-MM-DD */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const period = parsePeriod({ from: sp.get('from'), to: sp.get('to') });
  const view = sp.get('view') === 'lines' ? 'lines' : sp.get('view') === 'products' ? 'products' : 'suppliers';
  try {
    const rows = await loadMarginRows(period, view);
    const body = view === 'lines' ? lineMarginCsv(rows as MarginLine[]) : view === 'products' ? productMarginCsv(rows as ProductMargin[]) : supplierMarginCsv(rows as SupplierMargin[]);
    return new Response('﻿' + body, { headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="reckon-margin-${view}-${period.from}-to-${period.to}.csv"`,
      'Cache-Control': 'no-store',
    } });
  } catch {
    return Response.json({ error: 'Unable to export margin records. Sign in and try again.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
}

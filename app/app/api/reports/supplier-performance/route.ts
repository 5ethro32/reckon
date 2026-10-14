import type { NextRequest } from 'next/server';
import { loadSupplierPerformance } from '@/lib/margin-data';
import { supplierPerformanceCsv } from '@/lib/margin-report';
import { parsePeriod } from '@/lib/period';
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const period = parsePeriod({ from: sp.get('from'), to: sp.get('to') });
  try {
    const rows = await loadSupplierPerformance(period);
    return new Response('﻿' + supplierPerformanceCsv(rows), { headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="reckon-supplier-performance-${period.from}-to-${period.to}.csv"`,
      'Cache-Control': 'no-store',
    } });
  } catch {
    return Response.json({ error: 'Unable to export supplier performance. Sign in and try again.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
}

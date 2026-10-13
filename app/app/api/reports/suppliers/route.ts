import { loadOperations } from '@/lib/operations-data';
import { supplierCsv } from '@/lib/operations-summary';
export async function GET() {
  try {
    const data = await loadOperations();
    return new Response('\uFEFF' + supplierCsv(data.suppliers), { headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="reckon-supplier-overview.csv"',
      'Cache-Control': 'no-store',
    } });
  } catch {
    return Response.json({ error: 'Unable to export your records. Sign in and try again.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
}

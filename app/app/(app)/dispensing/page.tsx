/**
 * Dispensing: what the dispensing system says left the shelf, beside what was bought.
 *
 * Per product: packs dispensed each month (Positive Solutions Product Usage), stock on hand at the
 * latest Stock Value report, and packs invoiced over the same months. Invoice lines are counted
 * only when they link to exactly one product (see lib/pmr-match.ts); the rest are counted below.
 */
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { readAll } from '@/lib/paginated-read';
import { linkInvoiceLines, type PurchaseLine, type LineLink } from '@/lib/pmr-match';
import { buildReport, pmrProducts, type DispensingRow, type StockRow } from '@/lib/pmr-report';

type SearchParams = Promise<{ months?: string; site?: string; q?: string }>;
const SHOWN = 300;
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
function lastDay(m: string) { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y!, mo!, 0)).toISOString().slice(0, 10); }
function chunks<T>(xs: T[], n: number): T[][] { const out: T[][] = []; for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n)); return out; }

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function load(supabase: Supabase, pharmacyId: string, sp: Awaited<SearchParams>) {
  const { data: latest, error: latestError } = await supabase.from('pmr_dispensing').select('month').eq('pharmacy_id', pharmacyId).order('month', { ascending: false }).limit(1);
  if (latestError) throw new Error(latestError.message);
  const { data: snaps } = await supabase.from('pmr_stock_snapshots').select('snapshot_date').eq('pharmacy_id', pharmacyId).order('snapshot_date', { ascending: false }).limit(1);
  const snapshot = (snaps?.[0]?.snapshot_date as string | undefined) ?? null;
  if (!latest?.length && !snapshot) return null;

  const count = Math.min(12, Math.max(1, Number(sp.months) || 3));
  const end = ((latest?.[0]?.month as string | undefined) ?? new Date().toISOString()).slice(0, 7);
  const months = Array.from({ length: count }, (_, i) => { const d = new Date(`${end}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - (count - 1 - i)); return d.toISOString().slice(0, 7); });
  const start = `${months[0]}-01`, finish = lastDay(months[months.length - 1]!);

  const pmrCols = 'id,product_key,description,dmd_name,pack_size,pip';
  const [allDispensing, stock, lineRows, barcodes] = await Promise.all([
    readAll<DispensingRow & { id: string; site: string }>((after) => { let q = supabase.from('pmr_dispensing').select(`${pmrCols},site,month,packs`).eq('pharmacy_id', pharmacyId).gte('month', start).lte('month', finish).order('id').limit(1000); if (after) q = q.gt('id', after); return q; }),
    snapshot ? readAll<StockRow & { id: string }>((after) => { let q = supabase.from('pmr_stock_snapshots').select(`${pmrCols},location,quantity`).eq('pharmacy_id', pharmacyId).eq('snapshot_date', snapshot).order('id').limit(1000); if (after) q = q.gt('id', after); return q; }) : Promise.resolve(null),
    readAll<{ id: string; description: string; pack_size: string | null; supplier_sku: string | null; gtin: string | null; qty_ordered: number; invoices: { supplier: string } | { supplier: string }[] }>((after) => {
      let q = supabase.from('invoice_lines').select('id,description,pack_size,supplier_sku,gtin,qty_ordered,invoices!inner(supplier,invoice_date,deleted_at)')
        .eq('pharmacy_id', pharmacyId).gte('invoices.invoice_date', start).lte('invoices.invoice_date', finish).is('invoices.deleted_at', null).order('id').limit(1000);
      if (after) q = q.gt('id', after); return q;
    }),
    supabase.from('product_barcodes').select('supplier,supplier_sku,gtin').eq('pharmacy_id', pharmacyId),
  ]);
  const sites = [...new Set(allDispensing.map((d) => d.site).filter(Boolean))].sort();
  const site = sp.site && sites.includes(sp.site) ? sp.site : '';
  const dispensing = site ? allDispensing.filter((d) => d.site === site) : allDispensing;

  // Barcodes on lines or in the pharmacy's verified mappings identify the dm+d pack exactly.
  const mappedGtin = new Map((barcodes.data ?? []).map((b) => [`${b.supplier}|${b.supplier_sku}`, b.gtin as string]));
  const lines: (PurchaseLine & { qty: number })[] = lineRows.map((l) => ({ id: l.id, description: l.description, pack_size: l.pack_size, supplier_sku: l.supplier_sku, gtin: l.gtin, supplier: (Array.isArray(l.invoices) ? l.invoices[0]?.supplier : l.invoices.supplier) ?? '', qty: l.qty_ordered }));
  const gtins = [...new Set(lines.map((l) => l.gtin ?? mappedGtin.get(`${l.supplier}|${l.supplier_sku ?? ''}`)).filter((g): g is string => !!g))];
  const gtinToKey = new Map<string, string>();
  for (const part of chunks(gtins, 200)) {
    const { data } = await supabase.from('dmd_packs').select('gtin,name,generic_name').in('gtin', part);
    for (const d of data ?? []) gtinToKey.set(d.gtin, String(d.generic_name ?? d.name).toLowerCase().replace(/\s+/g, ' ').trim());
  }
  const links: Map<string, LineLink> = linkInvoiceLines(pmrProducts([...dispensing, ...(stock ?? [])]), lines, gtinToKey, mappedGtin);
  const report = buildReport(dispensing, stock, lines, links);
  const linked = [...links.values()].filter((l) => l.key).length;
  const ambiguous = [...links.values()].filter((l) => l.source === 'ambiguous').length;
  const q = (sp.q ?? '').trim().toLowerCase();
  const shown = (q ? report.filter((p) => p.name.toLowerCase().includes(q)) : report).slice(0, SHOWN);
  const total = q ? report.filter((p) => p.name.toLowerCase().includes(q)).length : report.length;
  const inDmd = report.filter((p) => p.inDmd).length;

  return { snapshot, count, months, lines, linked, ambiguous, report, shown, total, inDmd, sites, site };
}

export default async function DispensingPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: memberships } = await supabase.from('pharmacy_memberships').select('pharmacy_id').eq('user_id', user?.id ?? '').limit(1);
  const pharmacyId = memberships?.[0]?.pharmacy_id as string | undefined;
  if (!pharmacyId) return <Message title="No pharmacy" body="Your account is not linked to a pharmacy yet." />;

  let data: Awaited<ReturnType<typeof load>>;
  try {
    data = await load(supabase, pharmacyId, sp);
  } catch (err) {
    return <Message title="Dispensing is unavailable" body={`Check that migration 0019 has been run. ${err instanceof Error ? err.message : ''}`} />;
  }
  if (!data) return <Empty />;
  const { snapshot, count, months, lines, linked, ambiguous, report, shown, total, inDmd, sites, site } = data;
  return (
    <div>
      <Header />
      <div className="card card-padded" style={{ marginBottom: '1.25rem' }}>
        <div className="stat-grid">
          <Stat label="Products" value={String(report.length)} />
          <Stat label="Found in dm+d" value={report.length ? `${Math.round((100 * inDmd) / report.length)}%` : 'n/a'} />
          <Stat label="Invoice lines linked" value={`${linked} of ${lines.length}`} />
          <Stat label="Stock report" value={snapshot ?? 'None'} />
        </div>
        <p style={{ fontSize: '12px', color: 'var(--muted)', margin: '1rem 0 0' }}>
          {monthLabel(months[0]!)} to {monthLabel(months[months.length - 1]!)}{site ? `, ${site}` : sites.length > 1 ? `, all ${sites.length} sites` : ''}.
          {' '}Bought counts invoice lines that match one product by barcode, PIP code, or medicine, strength, form and pack size.
          {lines.length - linked > 0 ? ` ${lines.length - linked} lines are not counted (${ambiguous} fit more than one product).` : ''}
          {sites.length > 1 && !site ? ' Invoices are for this pharmacy only, so compare them with its own site.' : ''}
        </p>
      </div>

      <form method="get" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <input className="input" name="q" defaultValue={sp.q ?? ''} placeholder="Search products" style={{ maxWidth: '18rem' }} />
        {sites.length > 1 && (
          <select className="input" name="site" defaultValue={site} style={{ maxWidth: '14rem' }}>
            <option value="">All sites</option>
            {sites.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <select className="input" name="months" defaultValue={String(count)} style={{ maxWidth: '9rem' }}>
          {[1, 2, 3, 6, 12].map((n) => <option key={n} value={n}>{n === 1 ? 'Last month' : `Last ${n} months`}</option>)}
        </select>
        <button className="btn btn-secondary btn-sm" type="submit">Show</button>
      </form>

      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Product</th>
              {months.map((m) => <th key={m} className="num">{monthLabel(m)}</th>)}
              <th className="num">Dispensed</th>
              <th className="num">Bought</th>
              <th className="num">On hand</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.key}>
                <td>
                  {p.name}
                  {!p.inDmd && <span className="badge badge-neutral" style={{ marginLeft: '0.5rem' }}>Not in dm+d</span>}
                </td>
                {months.map((m) => <td key={m} className="num tabular-nums">{p.dispensed[m] ? fmt(p.dispensed[m]!) : ''}</td>)}
                <td className="num tabular-nums">{fmt(p.dispensedTotal)}</td>
                <td className="num tabular-nums">{p.purchasedLines ? fmt(p.purchased) : ''}</td>
                <td className="num tabular-nums">{p.onHand === null ? '' : fmt(p.onHand)}{p.onOrder ? ` (+${fmt(p.onOrder)} on order)` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > shown.length && <p style={{ fontSize: '12px', color: 'var(--muted)' }}>Showing {shown.length} of {total} products, most dispensed first. Search to narrow the list.</p>}
    </div>
  );
}

function Header() {
  return (
    <div className="page-header" style={{ marginBottom: '1.25rem' }}>
      <div>
        <h1 className="page-header-title">Dispensing</h1>
        <p className="page-header-subtitle">Packs dispensed by month from your dispensing system, packs bought on invoices over the same months, and stock on hand.</p>
      </div>
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return <div className="stat-block"><p className="stat-block-label">{label}</p><p className="stat-block-value">{value}</p></div>;
}
function Empty() {
  return (
    <div>
      <Header />
      <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <h2 style={{ fontSize: '14px', fontWeight: 600, margin: '0 0 0.375rem' }}>No dispensing data yet</h2>
        <p style={{ fontSize: '12px', color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
          Export Product Usage and Stock Value from Positive Solutions Pharmacy Manager and drop the files on the <Link href="/upload" style={{ color: 'var(--brand)' }}>upload page</Link>.
        </p>
      </div>
    </div>
  );
}
function Message({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ padding: '1rem', borderRadius: '0.5rem', background: 'var(--status-critical-bg)', border: '1px solid var(--status-critical-border)', color: 'var(--status-critical-text)' }}>
      <p style={{ fontSize: '13px', fontWeight: 500, margin: 0 }}>{title}</p>
      <p style={{ fontSize: '12px', margin: '0.25rem 0 0' }}>{body}</p>
    </div>
  );
}

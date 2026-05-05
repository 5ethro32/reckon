import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

const supplierLabels: Record<string, string> = {
  aah: 'AAH', aver: 'Aver', phoenix: 'Phoenix',
  alliance: 'Alliance', ethigen: 'Ethigen', numark: 'Numark',
};

const docTypeLabels: Record<string, string> = {
  INV: 'Invoice', CRED: 'Credit', OTHER: 'Other',
};

export default async function StatementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: statement, error } = await supabase
    .from('statements')
    .select('id, supplier, statement_date, customer_account, customer_name, net_total, vat_total, gross_total, totals_match, warnings')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (error || !statement) notFound();

  const { data: lines } = await supabase
    .from('statement_lines')
    .select(`
      id, line_number, document_date, document_number, document_type,
      reference, due_date, net, vat, total,
      matched_invoice_id, match_status,
      invoices:matched_invoice_id ( id, invoice_number, gross_total, receipt_status )
    `)
    .eq('statement_id', statement.id)
    .order('line_number');

  const allLines = lines ?? [];
  const matchedLines = allLines.filter(l => l.match_status === 'matched');
  const unmatchedLines = allLines.filter(l => l.match_status === 'unmatched' && l.document_type === 'INV');
  const creditLines = allLines.filter(l => l.document_type === 'CRED');
  const matchedSum = matchedLines.reduce((s, l) => s + Number(l.total), 0);
  const variance = Number(statement.gross_total) - matchedSum - creditLines.reduce((s, l) => s + Number(l.total), 0);

  const warnings = statement.warnings as string[];

  const varianceIsHealthy = Math.abs(variance) <= 0.05;

  return (
    <div>
      <Link
        href="/statements"
        style={{
          fontSize: '12px',
          color: 'var(--muted)',
          textDecoration: 'none',
          marginBottom: '1rem',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.25rem',
        }}
      >
        <span aria-hidden style={{ fontSize: '14px', lineHeight: 1 }}>←</span>
        Back to statements
      </Link>

      <div className="card" style={{ padding: '1.5rem 1.75rem', marginBottom: '1.5rem' }}>
        <div style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: '1.75rem',
          gap: '1.5rem',
        }}>
          <div>
            <p className="section-label" style={{ marginBottom: '0.5rem' }}>
              {supplierLabels[statement.supplier] ?? statement.supplier} statement
            </p>
            <h1 style={{
              fontSize: '22px',
              fontWeight: 600,
              letterSpacing: '-0.02em',
              margin: 0,
              fontVariantNumeric: 'tabular-nums',
            }}>
              {new Date(statement.statement_date).toLocaleDateString('en-GB')}
            </h1>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{
              fontSize: '26px',
              fontWeight: 600,
              letterSpacing: '-0.02em',
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1.1,
              margin: 0,
            }}>
              £{Number(statement.gross_total).toFixed(2)}
            </p>
            <p style={{
              fontSize: '11px',
              color: 'var(--muted)',
              margin: 0,
              marginTop: '0.25rem',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontWeight: 600,
            }}>
              Statement total
            </p>
          </div>
        </div>

        <div className="stat-grid">
          <Stat label="Total rows" value={String(allLines.length)} />
          <Stat
            label="Matched"
            value={String(matchedLines.length)}
            color="var(--status-success-text)"
          />
          <Stat
            label="Unmatched"
            value={String(unmatchedLines.length)}
            color={unmatchedLines.length > 0 ? 'var(--status-warning-text)' : undefined}
          />
          <Stat
            label="Variance"
            value={`£${variance.toFixed(2)}`}
            color={varianceIsHealthy ? 'var(--status-success-text)' : 'var(--status-warning-text)'}
          />
        </div>

        {warnings.length > 0 && (
          <details style={{ marginTop: '1.5rem' }}>
            <summary style={{ fontSize: '11px', color: 'var(--muted)', cursor: 'pointer' }}>
              Parser warnings ({warnings.length})
            </summary>
            <ul style={{
              margin: '0.625rem 0 0 0',
              padding: '0 0 0 1rem',
              fontSize: '11px',
              color: 'var(--muted)',
              lineHeight: 1.6,
            }}>
              {warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </details>
        )}
      </div>

      <h2 style={{
        fontSize: '15px',
        fontWeight: 600,
        margin: 0,
        marginBottom: '0.75rem',
        letterSpacing: '-0.005em',
      }}>
        Reconciliation
      </h2>
      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Document</th>
              <th>Type</th>
              <th className="num">Total</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {allLines.map(line => {
              const isMatched = line.match_status === 'matched';
              const isCredit = line.document_type === 'CRED';
              const invoice = Array.isArray(line.invoices) ? line.invoices[0] : line.invoices;
              return (
                <tr
                  key={line.id}
                  className={!isMatched && !isCredit ? 'is-warning' : undefined}
                >
                  <td style={{ color: 'var(--muted)' }}>
                    {new Date(line.document_date).toLocaleDateString('en-GB')}
                  </td>
                  <td style={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                    {isMatched && invoice ? (
                      <Link
                        href={`/invoices/${invoice.id}`}
                        style={{ color: 'var(--foreground)', textDecoration: 'none' }}
                      >
                        {line.document_number}
                      </Link>
                    ) : (
                      line.document_number
                    )}
                  </td>
                  <td style={{ color: 'var(--muted)' }}>{docTypeLabels[line.document_type]}</td>
                  <td
                    className="num"
                    style={Number(line.total) < 0 ? { color: 'var(--status-warning-text)' } : undefined}
                  >
                    £{Number(line.total).toFixed(2)}
                  </td>
                  <td>
                    {isCredit ? (
                      <span className="badge badge-neutral">Credit note</span>
                    ) : isMatched ? (
                      <span className="badge badge-success">Matched</span>
                    ) : (
                      <span className="badge badge-warning">No invoice</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="stat-block">
      <p className="stat-block-label">{label}</p>
      <p className="stat-block-value" style={{ color: color ?? 'var(--foreground)' }}>
        {value}
      </p>
    </div>
  );
}

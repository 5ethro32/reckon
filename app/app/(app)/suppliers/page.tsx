/**
 * Suppliers settings — per-supplier credit chase email config.
 *
 * Lists all supplier_contacts rows for the user's pharmacy. The migration
 * seeds one row per known supplier on install, so this should never be
 * empty in practice, but we guard for it.
 */

import { Suspense } from 'react';
import { getRequestClient } from '@/lib/session';
import { CONTACT_EMAIL } from '@/lib/contact';
import { parsePeriod } from '@/lib/period';
import SupplierForm, { type SupplierContact } from './supplier-form';
import SupplierPerformance from './supplier-performance';

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const period = parsePeriod(await searchParams);
  const supabase = await getRequestClient();

  const { data, error } = await supabase
    .from('supplier_contacts')
    .select('id, supplier, credit_email, accounts_email, account_number, contact_name, signature')
    .order('supplier', { ascending: true });

  if (error) return <ErrorState message={error.message} />;

  const contacts = (data ?? []) as SupplierContact[];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-header-title">Suppliers</h1>
          <p className="page-header-subtitle">How each supplier performed, and where Reckon sends your claim emails.</p>
        </div>
      </div>

      {/* Ratings read a report over the whole period; the contacts below do not wait for it. */}
      <Suspense fallback={<div className="card" style={{ height: 220, marginBottom: '1.5rem' }} aria-busy="true" aria-label="Loading supplier ratings" />}>
        <SupplierPerformance period={period} />
      </Suspense>

      <div className="section-head">
        <div>
          <h2>Claim emails</h2>
          <p>Each field saves when you leave it.</p>
        </div>
      </div>

      {contacts.length === 0 ? (
        <EmptyState />
      ) : (
        <div>
          {contacts.map(c => (
            <SupplierForm key={c.id} contact={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="card empty-card">
      <h2>No suppliers yet</h2>
      <p>
        Suppliers are added when your pharmacy is set up. If this stays empty, email{' '}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> and we will sort it out.
      </p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="card notice" role="alert">
      <strong>Suppliers did not load</strong>
      <p>{message}</p>
    </div>
  );
}

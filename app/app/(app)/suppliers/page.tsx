/**
 * Suppliers settings — per-supplier credit chase email config.
 *
 * Lists all supplier_contacts rows for the user's pharmacy. The migration
 * seeds one row per known supplier on install, so this should never be
 * empty in practice, but we guard for it.
 */

import { createClient } from '@/lib/supabase/server';
import { CONTACT_EMAIL } from '@/lib/contact';
import SupplierForm, { type SupplierContact } from './supplier-form';

export default async function SuppliersPage() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('supplier_contacts')
    .select('id, supplier, credit_email, accounts_email, account_number, contact_name, signature')
    .order('supplier', { ascending: true });

  if (error) return <ErrorState message={error.message} />;

  const contacts = (data ?? []) as SupplierContact[];

  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 className="page-title" style={{ marginBottom: '0.25rem' }}>
          Suppliers
        </h1>
        <p style={{ fontSize: '12px', color: 'var(--muted)', margin: 0 }}>
          Set the email address Reckon uses for credit chase emails per supplier.
        </p>
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
    <div
      className="card"
      style={{
        textAlign: 'center',
        padding: '3rem 1rem',
      }}
    >
      <h2 style={{ fontSize: '14px', fontWeight: 600, margin: 0, marginBottom: '0.375rem' }}>
        Hmm, no suppliers here yet
      </h2>
      <p style={{ fontSize: '12px', color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
        Suppliers should seed automatically when your pharmacy is set up.
        If you’re seeing this, drop us a note at{' '}
        <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--brand)' }}>
          {CONTACT_EMAIL}
        </a>{' '}
        and we’ll fix it.
      </p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div
      style={{
        padding: '1rem',
        borderRadius: '0.5rem',
        background: 'var(--status-critical-bg)',
        border: '1px solid var(--status-critical-border)',
        color: 'var(--status-critical-text)',
      }}
    >
      <p style={{ fontSize: '13px', fontWeight: 500, margin: 0 }}>Couldn&apos;t load suppliers</p>
      <p style={{ fontSize: '12px', margin: 0, marginTop: '0.25rem' }}>{message}</p>
    </div>
  );
}

'use client';

/**
 * Editable form for one supplier_contacts row.
 *
 * Autosave-on-blur — matches the lines-editor pattern. Each field PATCHes
 * /api/suppliers when it loses focus and the value changed.
 */

import { useState } from 'react';

export type SupplierContact = {
  id: string;
  supplier: string;
  credit_email: string | null;
  accounts_email: string | null;
  account_number: string | null;
  contact_name: string | null;
  signature: string | null;
};

const supplierLabels: Record<string, string> = {
  aah: 'AAH',
  aver: 'Aver',
  phoenix: 'Phoenix',
  alliance: 'Alliance',
  ethigen: 'Ethigen',
  numark: 'Numark',
};

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

type EditableField = 'credit_email' | 'accounts_email' | 'account_number' | 'contact_name' | 'signature';

export default function SupplierForm({ contact }: { contact: SupplierContact }) {
  const [values, setValues] = useState<SupplierContact>(contact);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function commit(field: EditableField, value: string) {
    const trimmed = value.trim();
    const original = (contact[field] ?? '').toString().trim();
    const current = (values[field] ?? '').toString().trim();

    // Only fire if the field actually changed since last save
    if (trimmed === original && trimmed === current) return;

    setSaveState('saving');
    setErrorMsg(null);
    try {
      const res = await fetch('/api/suppliers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: contact.id, [field]: trimmed }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 1500);
    } catch (err) {
      setSaveState('error');
      setErrorMsg(err instanceof Error ? err.message : 'Save failed');
    }
  }

  function handleChange(field: keyof SupplierContact, value: string) {
    setValues(v => ({ ...v, [field]: value }));
  }

  return (
    <div className="card" style={{ padding: '1.25rem 1.25rem 1rem', marginBottom: '1rem' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '1rem',
        }}
      >
        <div>
          <p className="section-label" style={{ marginBottom: '0.125rem' }}>
            Supplier
          </p>
          <h2 style={{ fontSize: '15px', fontWeight: 600, margin: 0 }}>
            {supplierLabels[contact.supplier] ?? contact.supplier}
          </h2>
        </div>
        <SaveBadge state={saveState} errorMsg={errorMsg} />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '0.875rem 1rem',
        }}
      >
        <Field
          label="Credit email"
          hint="Where credit-request emails get sent"
          value={values.credit_email ?? ''}
          placeholder="credits@example.co.uk"
          onChange={v => handleChange('credit_email', v)}
          onBlur={v => commit('credit_email', v)}
          type="email"
        />
        <Field
          label="Accounts email"
          hint="Fallback for general account queries"
          value={values.accounts_email ?? ''}
          placeholder="accounts@example.co.uk"
          onChange={v => handleChange('accounts_email', v)}
          onBlur={v => commit('accounts_email', v)}
          type="email"
        />
        <Field
          label="Account number"
          hint="Your account ref with this supplier"
          value={values.account_number ?? ''}
          placeholder="e.g. TO004"
          onChange={v => handleChange('account_number', v)}
          onBlur={v => commit('account_number', v)}
        />
        <Field
          label="Contact name"
          hint="First name for greetings (optional)"
          value={values.contact_name ?? ''}
          placeholder="e.g. Mike"
          onChange={v => handleChange('contact_name', v)}
          onBlur={v => commit('contact_name', v)}
        />
        <div style={{ gridColumn: '1 / -1' }}>
          <label className="label">Email signature</label>
          <p style={{ fontSize: '11px', color: 'var(--muted)', margin: '0 0 0.375rem' }}>
            Appears at the bottom of credit-request emails. Leave empty to use your account email.
          </p>
          <textarea
            className="input"
            value={values.signature ?? ''}
            placeholder={'Thanks,\nStuart Burns'}
            onChange={e => handleChange('signature', e.target.value)}
            onBlur={e => commit('signature', e.target.value)}
            rows={3}
            style={{ height: 'auto', padding: '0.5rem 0.75rem', resize: 'vertical' }}
          />
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  value,
  placeholder,
  onChange,
  onBlur,
  type = 'text',
}: {
  label: string;
  hint?: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  onBlur: (v: string) => void;
  type?: string;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      {hint && (
        <p style={{ fontSize: '11px', color: 'var(--muted)', margin: '0 0 0.375rem' }}>{hint}</p>
      )}
      <input
        className="input"
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        onBlur={e => onBlur(e.target.value)}
      />
    </div>
  );
}

function SaveBadge({ state, errorMsg }: { state: SaveState; errorMsg: string | null }) {
  if (state === 'idle') return null;
  if (state === 'saving') {
    return (
      <span style={{ fontSize: '11px', color: 'var(--muted)' }}>Saving…</span>
    );
  }
  if (state === 'saved') {
    return (
      <span className="badge badge-success">Saved</span>
    );
  }
  return (
    <span
      className="badge badge-critical"
      title={errorMsg ?? undefined}
      style={{ maxWidth: '24rem', overflow: 'hidden', textOverflow: 'ellipsis' }}
    >
      Save failed{errorMsg ? ` — ${errorMsg}` : ''}
    </span>
  );
}

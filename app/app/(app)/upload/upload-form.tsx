'use client';

/**
 * Upload form — drag-drop or file picker.
 * Posts to /api/upload, displays per-file status.
 */

import { useRouter } from 'next/navigation';
import { useState, useRef } from 'react';

type UploadResult = {
  ok: true;
  documentId: string;
  kind: 'invoice' | 'statement';
  supplier: string;
  summary: string;
} | {
  ok: false;
  error: string;
};

export default function UploadForm() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploads, setUploads] = useState<{ filename: string; status: 'uploading' | UploadResult }[]>([]);

  async function handleFiles(files: FileList | File[]) {
    const filesArray = Array.from(files).filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    if (filesArray.length === 0) return;

    const startIndex = uploads.length;
    setUploads(prev => [
      ...prev,
      ...filesArray.map(f => ({ filename: f.name, status: 'uploading' as const })),
    ]);

    for (let i = 0; i < filesArray.length; i++) {
      const file = filesArray[i]!;
      const formData = new FormData();
      formData.append('file', file);

      try {
        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        const result: UploadResult = await res.json();
        setUploads(prev => {
          const next = [...prev];
          next[startIndex + i] = { filename: file.name, status: result };
          return next;
        });
      } catch (err) {
        setUploads(prev => {
          const next = [...prev];
          next[startIndex + i] = {
            filename: file.name,
            status: { ok: false, error: err instanceof Error ? err.message : 'Upload failed' },
          };
          return next;
        });
      }
    }

    router.refresh();
  }

  return (
    <div>
      {/* Drop zone */}
      <div
        className="dropzone"
        data-dragging={isDragging}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => fileInput.current?.click()}
      >
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
        <svg
          style={{ marginBottom: '0.875rem' }}
          width="36"
          height="36"
          viewBox="0 0 24 24"
          fill="none"
          stroke={isDragging ? 'var(--brand)' : 'var(--muted-light)'}
          strokeWidth="1.5"
          aria-hidden
        >
          <path d="M12 16V4M12 4l-4 4M12 4l4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p style={{ fontSize: '14px', fontWeight: 500, margin: 0, marginBottom: '0.375rem' }}>
          Drop PDFs here or click to upload
        </p>
        <p style={{ fontSize: '12px', color: 'var(--muted)', margin: 0 }}>
          AAH · Aver · Phoenix · Alliance · Ethigen · Numark
        </p>
      </div>

      {/* Upload results */}
      {uploads.length > 0 && (
        <div style={{ marginTop: '1.5rem' }}>
          <p className="section-label" style={{ marginBottom: '0.625rem' }}>
            {uploads.length === 1 ? 'Upload' : 'Uploads'}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {uploads.map((u, i) => (
              <UploadRow key={i} {...u} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function UploadRow({ filename, status }: { filename: string; status: 'uploading' | UploadResult }) {
  const baseStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '1rem',
    padding: '0.75rem 1rem',
    borderRadius: '0.5rem',
    border: '1px solid var(--border-subtle)',
    background: 'var(--card-bg)',
  };

  if (status === 'uploading') {
    return (
      <div style={baseStyle} className="fade-in">
        <span style={{ fontSize: '13px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {filename}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
          <span
            style={{
              width: '0.875rem',
              height: '0.875rem',
              borderRadius: '50%',
              border: '2px solid var(--border)',
              borderTopColor: 'var(--foreground)',
              animation: 'reckon-spin 700ms linear infinite',
              display: 'inline-block',
            }}
          />
          <span style={{ fontSize: '11px', color: 'var(--muted)' }}>Parsing</span>
        </span>
      </div>
    );
  }

  if (!status.ok) {
    return (
      <div
        className="fade-in"
        style={{
          ...baseStyle,
          background: 'var(--status-critical-bg)',
          borderColor: 'var(--status-critical-border)',
        }}
      >
        <span style={{ fontSize: '13px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {filename}
        </span>
        <span style={{ fontSize: '11px', color: 'var(--status-critical-text)' }}>
          {status.error}
        </span>
      </div>
    );
  }

  return (
    <div style={baseStyle} className="fade-in">
      <div style={{ minWidth: 0 }}>
        <p style={{
          fontSize: '13px',
          fontWeight: 500,
          margin: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {filename}
        </p>
        <p style={{ fontSize: '11px', color: 'var(--muted)', margin: 0, marginTop: '0.125rem' }}>
          {status.summary}
        </p>
      </div>
      <a
        href={status.kind === 'invoice' ? `/invoices/${status.documentId}` : `/statements/${status.documentId}`}
        style={{
          fontSize: '12px',
          color: 'var(--foreground)',
          textDecoration: 'none',
          fontWeight: 500,
          whiteSpace: 'nowrap',
        }}
      >
        View →
      </a>
    </div>
  );
}

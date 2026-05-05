import UploadForm from './upload-form';

type SearchParams = Promise<{ type?: string }>;

export default async function UploadPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const type = sp.type === 'invoice' || sp.type === 'statement' ? sp.type : null;

  const subtitle = type === 'invoice'
    ? 'Drop a wholesaler invoice PDF. We’ll match it against your statements.'
    : type === 'statement'
    ? 'Drop a wholesaler statement PDF. We’ll reconcile it against your delivered invoices.'
    : 'Drop a wholesaler invoice or statement PDF. We’ll auto-detect the supplier and document type.';

  return (
    <div style={{ maxWidth: '42rem', margin: '0 auto' }}>
      <div className="page-header" style={{ marginBottom: '1.75rem' }}>
        <div>
          <h1 className="page-header-title">
            {type === 'invoice'
              ? 'Upload an invoice'
              : type === 'statement'
              ? 'Upload a statement'
              : 'Upload a document'}
          </h1>
          <p className="page-header-subtitle">{subtitle}</p>
        </div>
      </div>
      <UploadForm />
    </div>
  );
}

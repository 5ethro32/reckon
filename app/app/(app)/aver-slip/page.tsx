import SlipScanner from './slip-scanner';
import '@/components/goods-in/goods-in.css';
import './aver-slip.css';

export const metadata = { title: 'Scan Aver slip' };

/** Scan the QR on an Aver delivery's picking slip: its invoices come in with every line, ready to check. */
export default function AverSlipPage() {
  return (
    <div className="gi as">
      <header className="as-head">
        <h1 className="as-title">Scan Aver slip</h1>
        <p className="gi-note">Scan the square code on the Aver picking slip in the box. The invoice comes in with every line, ready to check.</p>
      </header>
      <SlipScanner />
    </div>
  );
}

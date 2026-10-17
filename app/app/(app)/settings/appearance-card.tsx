'use client';

/**
 * Appearance: follow the device (Auto), or always Light or Dark in this
 * browser. The same choice as the sidebar switch and the phone More sheet.
 */

import { useEffect, useState } from 'react';
import { setTheme, themeChoice, type ThemeChoice } from '@/lib/theme';

const LABELS: Record<ThemeChoice, string> = { auto: 'Auto', light: 'Light', dark: 'Dark' };

export default function AppearanceCard() {
  const [choice, setChoice] = useState<ThemeChoice>('auto');
  useEffect(() => {
    const sync = () => setChoice(themeChoice());
    sync();
    window.addEventListener('reckon-theme', sync);
    return () => window.removeEventListener('reckon-theme', sync);
  }, []);
  return (
    <div className="card" style={{ padding: '1.25rem' }}>
      <p className="section-label" id="appearance-label" style={{ marginBottom: '0.75rem' }}>Appearance</p>
      <div className="segmented" role="group" aria-labelledby="appearance-label" style={{ maxWidth: '20rem' }}>
        {(Object.keys(LABELS) as ThemeChoice[]).map(c => (
          <button key={c} type="button" aria-pressed={choice === c} onClick={() => { setTheme(c); setChoice(c); }}>
            {LABELS[c]}
          </button>
        ))}
      </div>
      <p className="field-hint" style={{ margin: '0.6rem 0 0' }}>Auto follows this device’s light or dark setting. Kept in this browser only.</p>
    </div>
  );
}

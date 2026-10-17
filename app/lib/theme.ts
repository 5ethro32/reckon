/**
 * Light or dark. By default Reckon follows the device (a phone in dark mode
 * gets a dark Reckon); the sidebar switch and Settings › Appearance override
 * that, kept in this browser under localStorage "reckon-theme".
 *
 * <html> carries data-theme. THEME_SCRIPT runs inline in <head> before the
 * page paints, so it never flashes light first, and keeps following the
 * device while no choice is saved.
 */

export type ThemeChoice = 'auto' | 'light' | 'dark';

const KEY = 'reckon-theme';

export const THEME_SCRIPT = `try{var r=document.documentElement,m=matchMedia("(prefers-color-scheme: dark)"),s=function(){var o=localStorage.getItem("${KEY}");r.dataset.theme=(o==="dark"||o==="light")?o:(m.matches?"dark":"light")};s();m.addEventListener("change",s)}catch(e){}`;

export function themeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'dark' || v === 'light' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function currentTheme(): 'light' | 'dark' {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/** Apply a choice now and keep it ("auto" forgets any saved choice). */
export function setTheme(choice: ThemeChoice): void {
  try {
    if (choice === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Private browsing: the choice lasts for this page only.
  }
  const dark = choice === 'dark' || (choice === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  window.dispatchEvent(new Event('reckon-theme'));
}

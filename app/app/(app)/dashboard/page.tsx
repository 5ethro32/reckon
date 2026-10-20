import { loadHome } from '@/lib/home/home-data';
import HomeView from './home-view';
import '@/components/goods-in/goods-in.css';
import './home.css';

export default async function HomePage() {
  let data;
  try { data = await loadHome(); } catch {
    return (
      <div className="gi">
        <section className="gi-card" role="alert" style={{ padding: 20 }}>
          <h1 className="hm-title">Home is unavailable</h1>
          <p className="gi-note">Your records could not all be loaded, so no partial totals are shown. Refresh to try again.</p>
        </section>
      </div>
    );
  }
  return <HomeView data={data} />;
}

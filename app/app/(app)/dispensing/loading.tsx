// Shown at once on navigation while the page's data loads.
import { SkeletonPage } from '../ui';

export default function Loading() {
  return <SkeletonPage figures={4} rows={10} />;
}

// Shown at once on navigation while the page's data loads.
import { SkeletonPage } from '../ui';

export default function Loading() {
  return <SkeletonPage rows={10} />;
}

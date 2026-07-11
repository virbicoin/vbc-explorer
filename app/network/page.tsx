import { permanentRedirect } from 'next/navigation';

// The Network page has been merged into /stats. Keep the old URL working
// by permanently redirecting to the combined Network Statistics page.
export default function NetworkPage(): never {
  permanentRedirect('/stats');
}

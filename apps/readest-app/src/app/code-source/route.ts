// lisetlead.com/code-source: the complete source code of the version running on
// the site (AGPL-3.0, section 13). One address of our own on every page that cites
// it, whatever the code host is called (owner's order of 28 Nov 2026).
import { getSourceCodeUrl } from '@/services/constants';

export const dynamic = 'force-dynamic';

export function GET() {
  return new Response(null, {
    status: 302,
    headers: { Location: getSourceCodeUrl(), 'Cache-Control': 'no-store' },
  });
}

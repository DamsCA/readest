// lisetlead.com/guide: our free French guide, « La formule de Kevin Trudeau » (6 ingredients out of 45),
// written by ktaffilliate/guide_fr (fabriquer_guide_web.py --lisetlead) into public/guide.html.
// The owner's decision (25 Nov 2026): « Moi je veux notre lien avec la liseuse » — the guide lives on
// the reader's own address, next to « Ça marche ». The same guide is offered as a book at sign-up
// (src/libs/ouiread/welcomeGift.ts). 302: never cached for good, so the page can move later.

export const dynamic = 'force-dynamic';

export function GET() {
  return new Response(null, {
    status: 302,
    headers: { Location: 'https://lisetlead.com/guide.html', 'Cache-Control': 'no-store' },
  });
}

// lisetlead.com/suite: the QR code on the last page of the gift book « Ça marche ».
// R. H. Jarrett's It Works is the second book Kevin Trudeau recommends at the
// end of Your Wish Is Your Command, which he gives away with the recording of
// his Swiss Alps seminar on this page. A redirect of our own, so that the
// destination can change without remaking the book already in readers'
// libraries (302: never cached for good).

export const dynamic = 'force-dynamic';

const DESTINATION = 'https://freeyourwish.kevintrudeau.com/?ref=dv8x7b';

export function GET() {
  return new Response(null, {
    status: 302,
    headers: { Location: DESTINATION, 'Cache-Control': 'no-store' },
  });
}

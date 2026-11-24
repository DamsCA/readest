// lisetlead.com/suite: the QR code on the last page of the gift book « Ça marche ».
// R. H. Jarrett's It Works is the second book Kevin Trudeau recommends at the
// end of Your Wish Is Your Command. That book is only in English and can only
// be read in its publisher's own reader, so the code leads to our free French
// guide to it, whose last pages explain the English sign-up page step by step
// (owner's decision, 24 Nov 2026). A redirect of our own, so that the
// destination can change without remaking the book already in readers'
// libraries (302: never cached for good).

export const dynamic = 'force-dynamic';

const DESTINATION = 'https://legenieendormi.web.app/guide';

export function GET() {
  return new Response(null, {
    status: 302,
    headers: { Location: DESTINATION, 'Cache-Control': 'no-store' },
  });
}

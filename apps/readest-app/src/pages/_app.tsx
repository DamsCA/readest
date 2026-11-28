import Head from 'next/head';
import { AppProps } from 'next/app';
import { EnvProvider } from '@/context/EnvContext';
import Providers from '@/components/Providers';

import '../styles/globals.css';

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        {/*
         * `interactive-widget=resizes-content` is appended client-side
         * on Android only (Providers.tsx) so other browsers don't
         * warn about the unrecognized key on every page load.
         */}
        <meta
          name='viewport'
          content='minimum-scale=1, initial-scale=1, width=device-width, shrink-to-fit=no, user-scalable=no, viewport-fit=cover'
        />
        <meta name='application-name' content='Lis et Lead' />
        <meta name='apple-mobile-web-app-capable' content='yes' />
        <meta name='apple-mobile-web-app-status-bar-style' content='default' />
        <meta name='apple-mobile-web-app-title' content='Lis et Lead' />
        <meta
          name='description'
          content='Lis et Lead traduit vos livres en français et vous les lit à voix haute.'
        />
        <meta name='format-detection' content='telephone=no' />
        <meta name='mobile-web-app-capable' content='yes' />
        <meta name='theme-color' content='white' />
        <link rel='manifest' href='/manifest.json' />
      </Head>
      <EnvProvider>
        <Providers>
          <Component {...pageProps} />
        </Providers>
      </EnvProvider>
    </>
  );
}

export default MyApp;

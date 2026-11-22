import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { getBaseUrl } from '@/services/environment';
import Link from './Link';

// Ouiread's own legal pages, at the web address (also reachable from the apps).
const LegalLinks = () => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const base = getBaseUrl().replace(/\/$/, '');
  const isAppleApp = appService?.isIOSApp || appService?.isMacOSApp;
  const linkClass = 'text-blue-500 underline hover:text-blue-600';

  return (
    <div className='my-2 flex flex-wrap justify-center gap-4 text-sm sm:text-xs'>
      {isAppleApp && (
        <Link
          href='https://www.apple.com/legal/internet-services/itunes/dev/stdeula/'
          className={linkClass}
        >
          {_('Terms of Service')}
        </Link>
      )}
      <Link href={`${base}/mentions-legales`} className={linkClass}>
        {_('Legal Notice')}
      </Link>
      <Link href={`${base}/confidentialite`} className={linkClass}>
        {_('Privacy Policy')}
      </Link>
    </div>
  );
};

export default LegalLinks;

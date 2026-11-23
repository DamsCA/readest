import { useEffect, useState } from 'react';
import { IconTranslate } from '@/components/icons/lisetlead';

import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { saveViewSettings } from '@/helpers/settings';
import { isTranslationAvailable } from '@/services/translators/utils';
import Button from '@/components/Button';

const TranslationToggler = ({ bookKey }: { bookKey: string }) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { getBookData } = useBookDataStore();
  const { getViewSettings, setViewSettings, setHoveredBookKey } = useReaderStore();

  const iconSize20 = useResponsiveSize(20);
  const bookData = getBookData(bookKey);
  const viewSettings = getViewSettings(bookKey)!;
  const [translationEnabled, setTranslationEnabled] = useState(viewSettings.translationEnabled!);
  const [translationAvailable, setTranslationAvailable] = useState(
    isTranslationAvailable(
      bookData?.book,
      viewSettings.translateTargetLang,
      viewSettings.translationProvider,
    ),
  );

  useEffect(() => {
    if (translationEnabled === viewSettings.translationEnabled) return;
    if (appService?.isMobile) {
      setHoveredBookKey('');
    }
    saveViewSettings(envConfig, bookKey, 'translationEnabled', translationEnabled, true, false);
    viewSettings.translationEnabled = translationEnabled;
    setViewSettings(bookKey, { ...viewSettings });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [translationEnabled]);

  useEffect(() => {
    setTranslationEnabled(viewSettings.translationEnabled);
    setTranslationAvailable(
      isTranslationAvailable(
        bookData?.book,
        viewSettings.translateTargetLang,
        viewSettings.translationProvider,
      ),
    );
  }, [
    bookData,
    viewSettings.translationEnabled,
    viewSettings.translateTargetLang,
    viewSettings.translationProvider,
  ]);

  return (
    <Button
      icon={
        <IconTranslate
          className={translationEnabled ? 'lel-accent-text' : 'text-base-content'}
          size={iconSize20}
        />
      }
      aria-label={_('Toggle Translation')}
      disabled={!translationAvailable && !translationEnabled}
      onClick={() => setTranslationEnabled(!translationEnabled)}
      label={
        translationAvailable
          ? translationEnabled
            ? _('Disable Translation')
            : _('Enable Translation')
          : _('Translation Disabled')
      }
    ></Button>
  );
};

export default TranslationToggler;

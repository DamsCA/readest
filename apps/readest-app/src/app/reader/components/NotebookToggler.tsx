import React from 'react';
import { IconNotebook } from '@/components/icons/lisetlead';

import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useNotebookStore } from '@/store/notebookStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import Button from '@/components/Button';

interface NotebookTogglerProps {
  bookKey: string;
}

const NotebookToggler: React.FC<NotebookTogglerProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { setHoveredBookKey } = useReaderStore();
  const { sideBarBookKey, setSideBarBookKey } = useSidebarStore();
  const { isNotebookVisible, toggleNotebook } = useNotebookStore();
  const iconSize18 = useResponsiveSize(18);

  const handleToggleSidebar = () => {
    if (appService?.isMobile) {
      setHoveredBookKey('');
    }
    if (sideBarBookKey === bookKey) {
      toggleNotebook();
    } else {
      setSideBarBookKey(bookKey);
      if (!isNotebookVisible) toggleNotebook();
    }
  };
  return (
    <Button
      icon={
        sideBarBookKey == bookKey && isNotebookVisible ? (
          <IconNotebook size={iconSize18} className='text-base-content' />
        ) : (
          <IconNotebook size={iconSize18} className='text-base-content' />
        )
      }
      onClick={handleToggleSidebar}
      label={_('Notebook')}
    ></Button>
  );
};

export default NotebookToggler;

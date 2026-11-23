import clsx from 'clsx';
import { IconFromFile, IconLink, IconOnlineLibrary } from '@/components/icons/lisetlead';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import MenuItem from '@/components/MenuItem';
import Menu from '@/components/Menu';

interface ImportMenuProps {
  setIsDropdownOpen?: (open: boolean) => void;
  onImportBooksFromFiles: () => void;
  onImportBooksFromDirectory?: () => void;
  onImportBookFromUrl?: () => void;
  onOpenCatalogManager: () => void;
}

const ImportMenu: React.FC<ImportMenuProps> = ({
  setIsDropdownOpen,
  onImportBooksFromFiles,
  onImportBooksFromDirectory,
  onImportBookFromUrl,
  onOpenCatalogManager,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();

  const handleImportFromFiles = () => {
    onImportBooksFromFiles();
    setIsDropdownOpen?.(false);
  };

  const handleImportFromDirectory = () => {
    onImportBooksFromDirectory?.();
    setIsDropdownOpen?.(false);
  };

  const handleImportFromUrl = () => {
    onImportBookFromUrl?.();
    setIsDropdownOpen?.(false);
  };

  const handleOpenCatalogManager = () => {
    onOpenCatalogManager();
    setIsDropdownOpen?.(false);
  };

  return (
    <Menu
      className={clsx('dropdown-content bg-base-100 rounded-box z-20 mt-3 w-max p-2 shadow')}
      onCancel={() => setIsDropdownOpen?.(false)}
    >
      <MenuItem
        label={_('From Local File')}
        Icon={<IconFromFile className='h-5 w-5' />}
        onClick={handleImportFromFiles}
      />
      {onImportBooksFromDirectory && (
        <MenuItem
          label={_('From Directory')}
          Icon={<IconFromFile className='h-5 w-5' />}
          onClick={handleImportFromDirectory}
        />
      )}
      {onImportBookFromUrl && (
        <MenuItem
          label={_('From Web URL')}
          Icon={<IconLink className='h-5 w-5' />}
          onClick={handleImportFromUrl}
        />
      )}
      <MenuItem
        label={appService?.isOnlineCatalogsAccessible ? _('Online Library') : _('OPDS Catalogs')}
        Icon={<IconOnlineLibrary className='h-5 w-5' />}
        onClick={handleOpenCatalogManager}
      />
    </Menu>
  );
};

export default ImportMenu;

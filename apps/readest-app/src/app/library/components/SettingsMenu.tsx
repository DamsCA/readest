import clsx from 'clsx';
import {
  IconAI,
  IconAutoTheme,
  IconBookmark,
  IconCloudSync,
  IconMoon,
  IconNext,
  IconSettings,
  IconSun,
  IconSync,
  IconSyncProblem,
  IconUser,
  IconUserChecked,
} from '@/components/icons/lisetlead';
import { PAYMENTS_ENABLED, READEST_CLOUD_ENABLED } from '@/services/features';
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { invoke, PermissionState } from '@tauri-apps/api/core';
import { isTauriAppPlatform, isWebAppPlatform } from '@/services/environment';
import { APP_DISPLAY_NAME } from '@/services/constants';
import { setBackupDialogVisible } from '@/app/library/components/BackupWindow';
import { setCacheManagerDialogVisible } from '@/app/library/components/CacheManagerWindow';
import { useAuth } from '@/context/AuthContext';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useQuotaStats } from '@/hooks/useQuotaStats';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useTransferQueue } from '@/hooks/useTransferQueue';
import { navigateToLogin, navigateToProfile } from '@/utils/nav';
import { tauriHandleSetAlwaysOnTop, tauriHandleToggleFullScreen } from '@/utils/window';
import { setAboutDialogVisible } from '@/components/AboutWindow';
import { setMigrateDataDirDialogVisible } from '@/app/library/components/MigrateDataWindow';
import { requestStoragePermission } from '@/utils/permission';
import { saveSysSettings } from '@/helpers/settings';
import {
  getBiometricStatus,
  getBiometryLabelKey,
  isBiometricSupported,
} from '@/services/biometric';
import { selectDirectory } from '@/utils/bridge';
import dayjs from 'dayjs';
import UserAvatar from '@/components/UserAvatar';
import MenuItem from '@/components/MenuItem';
import Quota from '@/components/Quota';
import Menu from '@/components/Menu';
import { type AppLockDialogMode, useAppLockStore } from '@/store/appLockStore';
import { TUTORIEL_REVOIR } from '@/app/library/utils/tutoriel';

interface SettingsMenuProps {
  onPullLibrary: (fullRefresh?: boolean, verbose?: boolean) => void;
  setIsDropdownOpen?: (isOpen: boolean) => void;
}

interface Permissions {
  postNotification: PermissionState;
  manageStorage: PermissionState;
}

const SettingsMenu: React.FC<SettingsMenuProps> = ({ onPullLibrary, setIsDropdownOpen }) => {
  const _ = useTranslation();
  const router = useRouter();
  const { envConfig, appService } = useEnv();
  const { user } = useAuth();
  const { userProfilePlan, quotas } = useQuotaStats(true);
  const { themeMode, setThemeMode } = useThemeStore();
  const { settings, setSettingsDialogOpen } = useSettingsStore();
  const [isAutoUpload, setIsAutoUpload] = useState(settings.autoUpload);
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(settings.alwaysOnTop);
  const [isAlwaysShowStatusBar, setIsAlwaysShowStatusBar] = useState(settings.alwaysShowStatusBar);
  const [isOpenLastBooks, setIsOpenLastBooks] = useState(settings.openLastBooks);
  const [isAutoImportBooksOnOpen, setIsAutoImportBooksOnOpen] = useState(
    settings.autoImportBooksOnOpen,
  );
  const [alwaysInForeground, setAlwaysInForeground] = useState(settings.alwaysInForeground);
  const [savedBookCoverForLockScreen, setSavedBookCoverForLockScreen] = useState(
    settings.savedBookCoverForLockScreen || '',
  );
  const iconSize = useResponsiveSize(16);

  const [isRefreshingMetadata, setIsRefreshingMetadata] = useState(false);
  const [refreshMetadataProgress, setRefreshMetadataProgress] = useState('');
  const { openDialog: openAppLockDialogInStore } = useAppLockStore();
  const isPinEnabled = !!settings.pinCodeEnabled;
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometryLabelKey, setBiometryLabelKey] = useState('');
  const showBiometricToggle = !!appService?.isMobileApp && isPinEnabled && biometricAvailable;

  useEffect(() => {
    if (!isBiometricSupported(appService) || !isPinEnabled) return;
    let cancelled = false;
    void getBiometricStatus().then(({ available, biometryType }) => {
      if (cancelled) return;
      setBiometricAvailable(available);
      setBiometryLabelKey(getBiometryLabelKey(biometryType));
    });
    return () => {
      cancelled = true;
    };
  }, [appService, isPinEnabled]);

  const toggleBiometricUnlock = () => {
    void saveSysSettings(envConfig, 'biometricUnlockEnabled', !settings.biometricUnlockEnabled);
  };

  const openAppLockDialog = (mode: AppLockDialogMode) => {
    openAppLockDialogInStore(mode);
    setIsDropdownOpen?.(false);
  };
  const { isSyncing, setLibrary } = useLibraryStore();
  const { stats, hasActiveTransfers, setIsTransferQueueOpen } = useTransferQueue();

  const openTransferQueue = () => {
    setIsTransferQueueOpen(true);
    setIsDropdownOpen?.(false);
  };

  const showAboutReadest = () => {
    setAboutDialogVisible(true);
    setIsDropdownOpen?.(false);
  };

  const handleUserLogin = () => {
    navigateToLogin(router);
    setIsDropdownOpen?.(false);
  };

  const handleUserProfile = () => {
    navigateToProfile(router);
    setIsDropdownOpen?.(false);
  };

  const handleManageSync = () => {
    router.push('/user?section=sync');
    setIsDropdownOpen?.(false);
  };

  const cycleThemeMode = () => {
    const nextMode = themeMode === 'auto' ? 'light' : themeMode === 'light' ? 'dark' : 'auto';
    setThemeMode(nextMode);
  };

  const handleFullScreen = () => {
    tauriHandleToggleFullScreen();
    setIsDropdownOpen?.(false);
  };

  const toggleOpenInNewWindow = () => {
    saveSysSettings(envConfig, 'openBookInNewWindow', !settings.openBookInNewWindow);
    setIsDropdownOpen?.(false);
  };

  const toggleAlwaysOnTop = () => {
    const newValue = !settings.alwaysOnTop;
    saveSysSettings(envConfig, 'alwaysOnTop', newValue);
    setIsAlwaysOnTop(newValue);
    tauriHandleSetAlwaysOnTop(newValue);
    setIsDropdownOpen?.(false);
  };

  const toggleAlwaysShowStatusBar = () => {
    const newValue = !settings.alwaysShowStatusBar;
    saveSysSettings(envConfig, 'alwaysShowStatusBar', newValue);
    setIsAlwaysShowStatusBar(newValue);
  };

  const toggleAutoUploadBooks = () => {
    const newValue = !settings.autoUpload;
    saveSysSettings(envConfig, 'autoUpload', newValue);
    setIsAutoUpload(newValue);

    if (newValue && !user) {
      navigateToLogin(router);
    }
  };

  const toggleAutoImportBooksOnOpen = () => {
    const newValue = !settings.autoImportBooksOnOpen;
    saveSysSettings(envConfig, 'autoImportBooksOnOpen', newValue);
    setIsAutoImportBooksOnOpen(newValue);
  };

  const toggleOpenLastBooks = () => {
    const newValue = !settings.openLastBooks;
    saveSysSettings(envConfig, 'openLastBooks', newValue);
    setIsOpenLastBooks(newValue);
  };

  // Signed in: straight to the offers on the account page. Not yet: create
  // the account first, then the offers.
  const handleUpgrade = () => {
    if (user) navigateToProfile(router);
    else router.push('/auth?inscription=1&redirect=/user');
    setIsDropdownOpen?.(false);
  };

  const handleSetRootDir = () => {
    setMigrateDataDirDialogVisible(true);
    setIsDropdownOpen?.(false);
  };

  const handleBackupRestore = () => {
    setIsDropdownOpen?.(false);
    setBackupDialogVisible(true);
  };

  const handleManageCache = () => {
    setIsDropdownOpen?.(false);
    setCacheManagerDialogVisible(true);
  };

  const handleRefreshMetadata = async () => {
    if (!appService || isRefreshingMetadata) return;
    setIsRefreshingMetadata(true);
    setRefreshMetadataProgress(_('Loading library...'));
    try {
      const books = await appService.loadLibraryBooks();
      const activeBooks = books.filter((b) => !b.deletedAt);
      let refreshed = 0;
      for (let i = 0; i < activeBooks.length; i++) {
        setRefreshMetadataProgress(`${i + 1} / ${activeBooks.length}`);
        try {
          if (await appService.refreshBookMetadata(activeBooks[i]!)) {
            refreshed++;
          }
        } catch {
          // Skip books whose files can't be opened
        }
      }
      setLibrary(books);
      await appService.saveLibraryBooks(books);
      setRefreshMetadataProgress(_('{{count}} books refreshed', { count: refreshed }));
      onPullLibrary(true);
      setTimeout(() => {
        setIsRefreshingMetadata(false);
        setRefreshMetadataProgress('');
      }, 2000);
    } catch (error) {
      console.error('Failed to refresh metadata:', error);
      setRefreshMetadataProgress(_('Failed to refresh metadata'));
      setTimeout(() => {
        setIsRefreshingMetadata(false);
        setRefreshMetadataProgress('');
      }, 2000);
    }
  };

  // The welcome tour of the web reader (Tutoriel.tsx), shown again on demand.
  const revoirTutoriel = () => {
    setIsDropdownOpen?.(false);
    window.dispatchEvent(new Event(TUTORIEL_REVOIR));
  };

  const openSettingsDialog = () => {
    setIsDropdownOpen?.(false);
    setSettingsDialogOpen(true);
  };

  const handleSetSavedBookCoverForLockScreen = async () => {
    if (!(await requestStoragePermission()) && appService?.distChannel === 'readest') return;

    const newValue = settings.savedBookCoverForLockScreen ? '' : 'default';
    if (newValue) {
      const response = await selectDirectory();
      if (response.path) {
        saveSysSettings(envConfig, 'savedBookCoverForLockScreenPath', response.path);
      }
    }
    saveSysSettings(envConfig, 'savedBookCoverForLockScreen', newValue);
    setSavedBookCoverForLockScreen(newValue);
  };

  const toggleAlwaysInForeground = async () => {
    const requestAlwaysInForeground = !settings.alwaysInForeground;

    if (requestAlwaysInForeground) {
      let permission = await invoke<Permissions>('plugin:native-tts|checkPermissions');
      if (permission.postNotification !== 'granted') {
        permission = await invoke<Permissions>('plugin:native-tts|requestPermissions', {
          permissions: ['postNotification'],
        });
      }
      if (permission.postNotification !== 'granted') return;
    }

    saveSysSettings(envConfig, 'alwaysInForeground', requestAlwaysInForeground);
    setAlwaysInForeground(requestAlwaysInForeground);
  };

  const handleSyncLibrary = () => {
    onPullLibrary(true, true);
    setIsDropdownOpen?.(false);
  };

  const avatarUrl = user?.user_metadata?.['picture'] || user?.user_metadata?.['avatar_url'];
  const userFullName = user?.user_metadata?.['full_name'];
  const userDisplayName = userFullName ? userFullName.split(' ')[0] : null;
  const themeModeLabel =
    themeMode === 'dark'
      ? _('Dark Mode')
      : themeMode === 'light'
        ? _('Light Mode')
        : _('Auto Mode');

  const savedBookCoverPath = settings.savedBookCoverForLockScreenPath;
  const coverDir = savedBookCoverPath ? savedBookCoverPath.split('/').pop() : 'Images';
  const savedBookCoverDescription = `💾 ${coverDir}/last-book-cover.png`;

  const lastSyncTime = Math.max(
    settings.lastSyncedAtBooks || 0,
    settings.lastSyncedAtConfigs || 0,
    settings.lastSyncedAtNotes || 0,
  );

  return (
    <Menu
      className={clsx(
        'settings-menu dropdown-content no-triangle',
        'z-20 mt-2 max-w-[90vw] shadow-2xl',
      )}
      onCancel={() => setIsDropdownOpen?.(false)}
    >
      {/* The owner's ask (23 Nov 2026): the way to Plus must stand out, first
          and in the logo's gold, for every reader not yet on Plus. */}
      {PAYMENTS_ENABLED && (!user || userProfilePlan === 'free') && (
        <button type='button' className='lel-plus-cta' onClick={handleUpgrade}>
          <IconAI size={22} aria-hidden='true' />
          <span className='lel-plus-cta-text'>
            <span className='font-display lel-plus-cta-title'>{_('Passer à Plus')}</span>
            <span className='lel-plus-cta-sub'>
              {_('Traduction digne d’un traducteur et voix premium')}
            </span>
          </span>
          <IconNext size={18} aria-hidden='true' />
        </button>
      )}
      {/* The owner's ask (23 Nov 2026): a Plus reader sees at once, in the
          menu, that the account is premium. Opens the account page, where the
          subscription is managed. */}
      {PAYMENTS_ENABLED && user && (userProfilePlan === 'plus' || userProfilePlan === 'pro') && (
        <button type='button' className='lel-plus-member' onClick={handleUpgrade}>
          <IconAI size={22} aria-hidden='true' />
          <span className='lel-plus-cta-text'>
            <span className='font-display lel-plus-cta-title'>
              {userProfilePlan === 'pro' ? _('Membre Pro') : _('Membre Plus')}
            </span>
            <span className='lel-plus-cta-sub'>{_('Votre compte premium est actif')}</span>
          </span>
          <span className='lel-plus-member-badge'>{_('Actif')}</span>
        </button>
      )}
      {READEST_CLOUD_ENABLED && user ? (
        <MenuItem
          label={
            userDisplayName
              ? _('Logged in as {{userDisplayName}}', { userDisplayName })
              : _('Logged in')
          }
          aria-label={_('View account details and quota')}
          Icon={
            avatarUrl ? (
              <UserAvatar url={avatarUrl} size={iconSize} DefaultIcon={IconUserChecked} />
            ) : (
              IconUserChecked
            )
          }
        >
          <ul className='ms-0 flex flex-col ps-0 before:hidden'>
            <MenuItem
              label={_('Cloud File Transfers')}
              Icon={IconCloudSync}
              description={
                hasActiveTransfers
                  ? _('{{activeCount}} active, {{pendingCount}} pending', {
                      activeCount: stats.active,
                      pendingCount: stats.pending,
                    })
                  : stats.failed > 0
                    ? _('{{failedCount}} failed', { failedCount: stats.failed })
                    : ''
              }
              onClick={openTransferQueue}
            />
            <MenuItem
              label={
                lastSyncTime
                  ? _('Synced {{time}}', {
                      time: dayjs(lastSyncTime).fromNow(),
                    })
                  : _('Never synced')
              }
              Icon={user ? IconSync : IconSyncProblem}
              labelClass='ps-2 pe-1 !mx-0'
              iconClassName={user && isSyncing ? 'animate-reverse-spin' : ''}
              onClick={handleSyncLibrary}
            />
            <button
              onClick={handleUserProfile}
              className='hover:bg-base-300 w-full rounded-md'
              style={{
                paddingInlineStart: `${iconSize}px`,
              }}
            >
              <Quota quotas={quotas} labelClassName='h-10 pl-3 pr-2' />
            </button>
            <MenuItem label={_('Account')} onClick={handleUserProfile} />
          </ul>
        </MenuItem>
      ) : READEST_CLOUD_ENABLED ? (
        <MenuItem label={_('Sign In')} Icon={IconUser} onClick={handleUserLogin}></MenuItem>
      ) : null}

      {READEST_CLOUD_ENABLED && (
        <MenuItem
          label={_('Auto Upload Books to Cloud')}
          toggled={isAutoUpload}
          onClick={toggleAutoUploadBooks}
        />
      )}

      {isTauriAppPlatform() && (
        <MenuItem
          label={_('Auto Import on File Open')}
          toggled={isAutoImportBooksOnOpen}
          onClick={toggleAutoImportBooksOnOpen}
        />
      )}
      {isTauriAppPlatform() && (
        <MenuItem
          label={_('Open Last Book on Start')}
          toggled={isOpenLastBooks}
          onClick={toggleOpenLastBooks}
        />
      )}
      {/* A divider only when something stands above it (nothing does on the web). */}
      {(READEST_CLOUD_ENABLED || isTauriAppPlatform()) && (
        <hr aria-hidden='true' className='border-base-200 my-1' />
      )}
      {appService?.hasWindow && (
        <MenuItem
          label={_('Open Book in New Window')}
          toggled={settings.openBookInNewWindow}
          onClick={toggleOpenInNewWindow}
        />
      )}
      {appService?.hasWindow && <MenuItem label={_('Fullscreen')} onClick={handleFullScreen} />}
      {appService?.hasWindow && (
        <MenuItem label={_('Always on Top')} toggled={isAlwaysOnTop} onClick={toggleAlwaysOnTop} />
      )}
      {appService?.isMobileApp && (
        <MenuItem
          label={_('Always Show Status Bar')}
          toggled={isAlwaysShowStatusBar}
          onClick={toggleAlwaysShowStatusBar}
        />
      )}
      {appService?.isAndroidApp && (
        <MenuItem
          label={_(_('Background Read Aloud'))}
          toggled={alwaysInForeground}
          onClick={toggleAlwaysInForeground}
        />
      )}
      <MenuItem
        label={themeModeLabel}
        Icon={themeMode === 'dark' ? IconMoon : themeMode === 'light' ? IconSun : IconAutoTheme}
        onClick={cycleThemeMode}
      />
      <MenuItem label={_('Settings')} Icon={IconSettings} onClick={openSettingsDialog} />
      {isWebAppPlatform() && (
        <MenuItem label={_('Revoir le tutoriel')} Icon={IconBookmark} onClick={revoirTutoriel} />
      )}
      <hr aria-hidden='true' className='border-base-200 my-1' />
      <MenuItem label={_('Advanced Settings')}>
        <ul className='ms-0 flex flex-col ps-0 before:hidden'>
          <MenuItem label={_('Backup & Restore')} onClick={handleBackupRestore} />
          {appService?.canCustomizeRootDir && (
            <MenuItem label={_('Change Data Location')} onClick={handleSetRootDir} />
          )}
          {user && <MenuItem label={_('Data Sync')} onClick={handleManageSync} />}
          {READEST_CLOUD_ENABLED && (
            <MenuItem
              label={_('Refresh Metadata')}
              description={refreshMetadataProgress}
              onClick={handleRefreshMetadata}
              disabled={isRefreshingMetadata}
            />
          )}
          {appService?.isMobileApp && (
            <MenuItem label={_('Manage Cache')} onClick={handleManageCache} />
          )}
          {!isPinEnabled && (
            <MenuItem
              label={_('Set PIN…')}
              tooltip={
                appService?.isMobileApp
                  ? _('Require a PIN (and biometrics, if available) to open Readest')
                  : _('Require a 4-digit PIN to open Readest')
              }
              onClick={() => openAppLockDialog('set')}
            />
          )}
          {isPinEnabled && (
            <MenuItem label={_('Change PIN…')} onClick={() => openAppLockDialog('change')} />
          )}
          {isPinEnabled && (
            <MenuItem label={_('Disable PIN…')} onClick={() => openAppLockDialog('disable')} />
          )}
          {showBiometricToggle && (
            <MenuItem
              label={_('Unlock with {{biometry}}', { biometry: _(biometryLabelKey) })}
              toggled={!!settings.biometricUnlockEnabled}
              onClick={toggleBiometricUnlock}
            />
          )}
          {appService?.isAndroidApp && appService?.distChannel !== 'playstore' && (
            <MenuItem
              label={_('Save Book Cover')}
              tooltip={_('Auto-save last book cover')}
              description={savedBookCoverForLockScreen ? savedBookCoverDescription : ''}
              toggled={!!savedBookCoverForLockScreen}
              onClick={handleSetSavedBookCoverForLockScreen}
            />
          )}
        </ul>
      </MenuItem>
      <hr aria-hidden='true' className='border-base-200 my-1' />
      <MenuItem
        label={_('About {{name}}', { name: APP_DISPLAY_NAME })}
        onClick={showAboutReadest}
      />
    </Menu>
  );
};

export default SettingsMenu;

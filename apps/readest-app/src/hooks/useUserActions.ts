import { useRouter } from 'next/navigation';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { deleteUser } from '@/libs/user';
import { eventDispatcher } from '@/utils/event';
import { saveSysSettings } from '@/helpers/settings';
import { viderEtagere } from '@/libs/ouiread/etagereDuCompte';
import { navigateToLibrary, navigateToResetPassword, navigateToUpdatePassword } from '@/utils/nav';

export const useUserActions = () => {
  const router = useRouter();
  const { envConfig, appService } = useEnv();
  const { logout } = useAuth();

  const handleLogout = async () => {
    await logout();
    // The account's books leave this browser with it; they stay online and
    // come back at its next sign-in (libs/ouiread/etagereDuCompte.ts).
    if (appService) {
      try {
        await viderEtagere(appService, envConfig);
      } catch (error) {
        console.warn('Shelf: could not clear it at sign-out', error);
      }
    }
    saveSysSettings(envConfig, 'keepLogin', false);
    navigateToLibrary(router);
  };

  const handleResetPassword = () => {
    navigateToResetPassword(router);
  };

  const handleUpdateEmail = () => {
    navigateToUpdatePassword(router);
  };

  const handleConfirmDelete = async (errorMessage: string) => {
    try {
      await deleteUser();
      await handleLogout();
    } catch (error) {
      console.error('Error deleting user:', error);
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: errorMessage,
      });
    }
  };

  return {
    handleLogout,
    handleUpdateEmail,
    handleResetPassword,
    handleConfirmDelete,
  };
};

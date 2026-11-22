import { useEffect, useRef, useState } from 'react';
import { PiUserCircle } from 'react-icons/pi';
import { getAPIBaseUrl } from '@/services/environment';
import { getAccessToken } from '@/utils/access';

// The reader's public profile: a pseudo and an avatar, shown to other readers
// in the coming leaderboard (22 Nov 2026). The picture is cropped to a square
// and shrunk to 256 x 256 here, before it is sent.

export const avatarUrlFor = (userId: string, version: number | null | undefined) =>
  version ? `${getAPIBaseUrl()}/profile/avatar/${userId}?v=${version}` : null;

const AVATAR_SIZE = 256;

// Unlike fetchWithAuth, hands back refusals (pseudo taken, etc.) instead of
// throwing, so their reason can be shown.
const callProfileApi = async (path: string, init: RequestInit = {}) => {
  const token = await getAccessToken();
  return fetch(`${getAPIBaseUrl()}${path}`, {
    ...init,
    headers: { ...init.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
};

const shrinkToSquare = async (file: File): Promise<Blob> => {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    AVATAR_SIZE,
    AVATAR_SIZE,
  );
  bitmap.close();
  const toBlob = (type: string, quality: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  // Older Safari cannot write WebP: it then hands back a PNG, so ask for JPEG.
  const webp = await toBlob('image/webp', 0.85);
  if (webp && webp.type === 'image/webp') return webp;
  const jpeg = await toBlob('image/jpeg', 0.85);
  if (!jpeg) throw new Error('Image could not be read');
  return jpeg;
};

const MESSAGES: Record<string, string> = {
  PSEUDO_INVALID: '3 à 20 caractères : lettres, chiffres, espaces, « _ », « . » ou « - ».',
  PSEUDO_RESERVED: 'Ce pseudo est réservé. Choisissez-en un autre.',
  PSEUDO_TAKEN: 'Ce pseudo est déjà pris. Choisissez-en un autre.',
  AVATAR_TYPE: 'Choisissez une image (JPEG, PNG ou WebP).',
  AVATAR_TOO_LARGE: 'Cette image est trop lourde.',
};

interface PublicProfileProps {
  userId: string;
  onChange?: (profile: { pseudo: string | null; avatarUrl: string | null }) => void;
}

const PublicProfile: React.FC<PublicProfileProps> = ({ userId, onChange }) => {
  const [loaded, setLoaded] = useState(false);
  const [pseudo, setPseudo] = useState('');
  const [savedPseudo, setSavedPseudo] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    callProfileApi('/profile')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { pseudo: string | null; avatarVersion: number | null } | null) => {
        if (cancelled || !data) return;
        setPseudo(data.pseudo ?? '');
        setSavedPseudo(data.pseudo);
        setAvatarUrl(avatarUrlFor(userId, data.avatarVersion));
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (loaded) onChange?.({ pseudo: savedPseudo, avatarUrl });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, savedPseudo, avatarUrl]);

  const savePseudo = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await callProfileApi('/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pseudo }),
      });
      const data = (await r.json().catch(() => ({}))) as { pseudo?: string; error?: string };
      if (r.ok && data.pseudo) {
        setPseudo(data.pseudo);
        setSavedPseudo(data.pseudo);
        setMessage({ text: 'Pseudo enregistré.' });
      } else {
        setMessage({
          text: MESSAGES[data.error || ''] || 'Enregistrement impossible.',
          error: true,
        });
      }
    } catch {
      setMessage({ text: 'Enregistrement impossible. Vérifiez votre connexion.', error: true });
    } finally {
      setBusy(false);
    }
  };

  const pickAvatar = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setMessage(null);
    try {
      const image = await shrinkToSquare(file);
      const r = await callProfileApi('/profile/avatar', {
        method: 'POST',
        headers: { 'Content-Type': image.type },
        body: image,
      });
      const data = (await r.json().catch(() => ({}))) as { avatarVersion?: number; error?: string };
      if (r.ok && data.avatarVersion) {
        setAvatarUrl(avatarUrlFor(userId, data.avatarVersion));
        setMessage({ text: 'Avatar enregistré.' });
      } else {
        setMessage({ text: MESSAGES[data.error || ''] || 'Envoi impossible.', error: true });
      }
    } catch {
      setMessage({ text: 'Cette image n’a pas pu être lue. Essayez-en une autre.', error: true });
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const removeAvatar = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await callProfileApi('/profile/avatar', { method: 'DELETE' });
      if (r.ok) setAvatarUrl(null);
    } finally {
      setBusy(false);
    }
  };

  const pseudoChanged = pseudo.trim() !== (savedPseudo ?? '');

  return (
    <section className='bg-base-100 border-base-300 rounded-xl border p-5'>
      <h3 className='text-base-content text-lg font-semibold'>Votre profil public</h3>
      <p className='text-base-content/70 mt-1 text-sm'>
        Bientôt, un classement des lecteurs : choisissez le pseudo et l’avatar que les autres
        lecteurs verront. Votre nom et votre e-mail restent privés.
      </p>

      <div className='mt-5 flex flex-col items-center gap-5 sm:flex-row sm:items-start'>
        <div className='flex flex-col items-center gap-2'>
          <button
            type='button'
            aria-label='Changer l’avatar'
            disabled={busy || !loaded}
            onClick={() => fileInput.current?.click()}
            className='ring-base-300 h-24 w-24 overflow-hidden rounded-full ring-2 transition hover:opacity-90'
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt='Votre avatar' className='h-full w-full object-cover' />
            ) : (
              <PiUserCircle className='text-base-content/40 h-full w-full' />
            )}
          </button>
          <div className='flex gap-3 text-sm'>
            <button
              type='button'
              disabled={busy || !loaded}
              onClick={() => fileInput.current?.click()}
              className='link'
            >
              {avatarUrl ? 'Changer' : 'Ajouter un avatar'}
            </button>
            {avatarUrl && (
              <button type='button' disabled={busy} onClick={removeAvatar} className='link'>
                Retirer
              </button>
            )}
          </div>
          <input
            ref={fileInput}
            type='file'
            accept='image/*'
            className='hidden'
            onChange={(e) => pickAvatar(e.target.files?.[0])}
          />
        </div>

        <div className='w-full flex-1'>
          <label htmlFor='pseudo' className='text-base-content text-sm font-medium'>
            Pseudo
          </label>
          <div className='mt-1 flex gap-2'>
            <input
              id='pseudo'
              type='text'
              maxLength={20}
              autoComplete='nickname'
              placeholder='Par exemple : LectriceDuSoir'
              value={pseudo}
              disabled={!loaded}
              onChange={(e) => setPseudo(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && pseudoChanged && !busy && savePseudo()}
              className='input input-bordered w-full'
            />
            <button
              type='button'
              disabled={busy || !loaded || !pseudoChanged || pseudo.trim().length < 3}
              onClick={savePseudo}
              className='btn btn-primary'
            >
              Enregistrer
            </button>
          </div>
          <p className='text-base-content/60 mt-1 text-xs'>
            3 à 20 caractères. Il doit être unique.
          </p>
          {message && (
            <p
              role='status'
              className={`mt-2 text-sm ${message.error ? 'text-error' : 'text-success'}`}
            >
              {message.text}
            </p>
          )}
        </div>
      </div>
    </section>
  );
};

export default PublicProfile;

'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/hooks/useTheme';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/utils/supabase';
import { readAppleReturn } from '../utils/appleWeb';

// Apple's answer arrives here from /api/auth/apple, with the ID token in the
// fragment (see ../utils/appleWeb.ts); Supabase checks it and opens the session.
export default function AppleReturnPage() {
  const _ = useTranslation();
  const router = useRouter();
  const { login } = useAuth();
  const [failed, setFailed] = useState(false);
  const handled = useRef(false);
  useTheme({ systemUIVisible: false });

  useEffect(() => {
    // Once only: the nonce serves a single sign-in.
    if (handled.current) return;
    handled.current = true;
    const answer = readAppleReturn(window.location.hash);
    // Take the token out of the address bar and the history straight away.
    window.history.replaceState(null, '', window.location.pathname);
    if (!answer.ok) {
      if (answer.reason === 'cancelled') router.replace('/');
      else setFailed(true);
      return;
    }
    (async () => {
      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: answer.idToken,
        nonce: answer.nonce,
      });
      if (error || !data.session || !data.user) {
        console.error('Apple sign-in failed:', error);
        setFailed(true);
        return;
      }
      login(data.session.access_token, data.user);
      router.replace(answer.next);
    })();
  }, [login, router]);

  if (failed) {
    return (
      <div className='bg-base-200/50 text-base-content hero h-screen items-center justify-center'>
        <div className='hero-content text-center'>
          <div className='max-w-md'>
            <p className='mb-5'>La connexion avec Apple n’a pas abouti. Réessayez.</p>
            <button className='btn btn-primary rounded-xl' onClick={() => router.replace('/auth')}>
              {_('Back to sign-in')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center'>
      <span className='loading loading-infinity loading-xl w-20' />
    </div>
  );
}

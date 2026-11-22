'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/hooks/useTheme';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/utils/supabase';
import { readGoogleReturn } from '../utils/googleWeb';

// Google sends the reader back here with an ID token in the fragment
// (see ../utils/googleWeb.ts); Supabase checks it and opens the session.
export default function GoogleReturnPage() {
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
    const answer = readGoogleReturn(window.location.hash);
    // Take the token out of the address bar and the history straight away.
    window.history.replaceState(null, '', window.location.pathname);
    if (!answer.ok) {
      if (answer.reason === 'cancelled') router.replace('/auth');
      else setFailed(true);
      return;
    }
    (async () => {
      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: answer.idToken,
        nonce: answer.nonce,
      });
      if (error || !data.session || !data.user) {
        console.error('Google sign-in failed:', error);
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
            <p className='mb-5'>{_('Google sign-in did not work. Please try again.')}</p>
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

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from '@/hooks/useTranslation';
import { WELCOME_GIFT_EVENT } from '@/libs/sync';

// The unwrapping of the welcome book (« Ça marche », libs/ouiread/welcomeGift.ts).
// Played once, when the server has just put the book in the library; it can be
// replayed with /library?cadeau (for a demo or a video).
//
// The scene: a midnight-blue and gold parcel drops in and wriggles; a tap opens it (or
// it opens by itself after a few seconds): the lid flies off, light and
// confetti burst out, and the book rises from the box.

type Stage = 'hidden' | 'arrive' | 'waiting' | 'open' | 'revealed';

const COVER = '/images/ca-marche-couverture.webp';
const AUTO_OPEN_MS = 4200;
const CONFETTI_COLORS = ['#e8c06a', '#f3ecdd', '#e8efff', '#e07a6b', '#b8862f', '#b2c4ec'];

// Same scatter on every render, without Math.random in render.
const confettiPieces = () => {
  let seed = 7;
  const next = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  return Array.from({ length: 42 }, (_, i) => {
    const angle = -Math.PI / 2 + (next() - 0.5) * Math.PI * 1.25;
    const distance = 140 + next() * 170;
    return {
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance,
      fall: 120 + next() * 160,
      rotate: (next() - 0.5) * 900,
      delay: next() * 0.18,
      duration: 1.3 + next() * 0.9,
      width: 6 + next() * 6,
      round: i % 4 === 0,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length]!,
    };
  });
};

export default function WelcomeGift() {
  const _ = useTranslation();
  const [stage, setStage] = useState<Stage>('hidden');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const pieces = useMemo(confettiPieces, []);

  const show = useCallback(() => {
    sessionStorage.removeItem(WELCOME_GIFT_EVENT);
    setStage((current) => (current === 'hidden' ? 'arrive' : current));
  }, []);

  useEffect(() => {
    if (
      sessionStorage.getItem(WELCOME_GIFT_EVENT) ||
      new URLSearchParams(window.location.search).has('cadeau')
    ) {
      show();
    }
    window.addEventListener(WELCOME_GIFT_EVENT, show);
    return () => window.removeEventListener(WELCOME_GIFT_EVENT, show);
  }, [show]);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (stage === 'arrive') {
      const t = setTimeout(() => setStage(reduced ? 'revealed' : 'waiting'), reduced ? 0 : 950);
      return () => clearTimeout(t);
    }
    if (stage === 'waiting') {
      const t = setTimeout(() => setStage('open'), AUTO_OPEN_MS);
      return () => clearTimeout(t);
    }
    if (stage === 'open') {
      const t = setTimeout(() => setStage('revealed'), 1500);
      return () => clearTimeout(t);
    }
    if (stage === 'revealed') {
      buttonRef.current?.focus();
    }
    return undefined;
  }, [stage]);

  useEffect(() => {
    if (stage === 'hidden') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setStage('hidden');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stage]);

  if (stage === 'hidden') return null;

  const opened = stage === 'open' || stage === 'revealed';

  // On document.body: the library's own containers would trap a fixed overlay.
  return createPortal(
    <div
      role='dialog'
      aria-modal='true'
      aria-label={_('A gift for you')}
      className={`lel-gift lel-gift--${stage}`}
    >
      <style>{STYLES}</style>
      <div className='lel-gift__stage'>
        <div className='lel-gift__rays' aria-hidden />
        <div className='lel-gift__confetti' aria-hidden>
          {opened &&
            pieces.map((p, i) => (
              <span
                key={i}
                style={
                  {
                    '--x': `${p.x}px`,
                    '--y': `${p.y}px`,
                    '--fall': `${p.fall}px`,
                    '--rot': `${p.rotate}deg`,
                    '--delay': `${p.delay}s`,
                    '--dur': `${p.duration}s`,
                    width: `${p.width}px`,
                    height: p.round ? `${p.width}px` : `${p.width * 0.45}px`,
                    borderRadius: p.round ? '50%' : '1px',
                    background: p.color,
                  } as React.CSSProperties
                }
              />
            ))}
        </div>
        <img className='lel-gift__book' src={COVER} alt='' draggable={false} />
        <button
          type='button'
          className='lel-gift__parcel'
          aria-label={_('Tap the gift to open it')}
          disabled={stage !== 'waiting'}
          onClick={() => setStage('open')}
        >
          <span className='lel-gift__box'>
            <span className='lel-gift__ribbon' />
          </span>
          <span className='lel-gift__lid'>
            <span className='lel-gift__ribbon' />
            <span className='lel-gift__bow'>
              <span className='lel-gift__loop lel-gift__loop--left' />
              <span className='lel-gift__loop lel-gift__loop--right' />
              <span className='lel-gift__knot' />
            </span>
          </span>
        </button>
        <span className='lel-gift__sparkle lel-gift__sparkle--1' aria-hidden>
          ✦
        </span>
        <span className='lel-gift__sparkle lel-gift__sparkle--2' aria-hidden>
          ✦
        </span>
        <span className='lel-gift__sparkle lel-gift__sparkle--3' aria-hidden>
          ✧
        </span>
      </div>

      <div className='lel-gift__text'>
        <p className='lel-gift__hint'>{_('Tap the gift to open it')}</p>
        <div className='lel-gift__message'>
          <p className='lel-gift__kicker'>{_('A gift for you')}</p>
          <h2 className='lel-gift__title'>Ça marche</h2>
          <p className='lel-gift__by'>
            {_('by R. H. Jarrett · the new French translation, our gift to you.')}
          </p>
          <p className='lel-gift__by'>{_('It is waiting for you in your library.')}</p>
          <button
            ref={buttonRef}
            type='button'
            className='lel-gift__cta'
            onClick={() => setStage('hidden')}
          >
            {_('Discover my book')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const STYLES = `
.lel-gift {
  position: fixed; inset: 0; z-index: 1000;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 24px 20px calc(24px + env(safe-area-inset-bottom));
  background: radial-gradient(120% 90% at 50% 30%, #1d273f 0%, #101728 55%, #090d16 100%);
  color: #f3ecdd; overflow: hidden;
  animation: lel-gift-fade .45s ease-out both;
  -webkit-tap-highlight-color: transparent;
}
.lel-gift__stage { position: relative; width: 280px; height: 400px; flex: none; }
@media (max-height: 720px) { .lel-gift__stage { transform: scale(.8); margin: -40px 0; } }

/* Light behind the book */
.lel-gift__rays {
  position: absolute; left: 50%; top: 122px; width: 520px; height: 520px; margin: -260px 0 0 -260px;
  border-radius: 50%; opacity: 0; transform: scale(.4);
  -webkit-mask-image: radial-gradient(circle, #000 18%, transparent 68%);
  mask-image: radial-gradient(circle, #000 18%, transparent 68%);
  transition: opacity .6s ease-out, transform 1.1s cubic-bezier(.2,.8,.2,1);
}
.lel-gift__rays::before {
  content: ''; position: absolute; inset: 0; border-radius: 50%;
  background: repeating-conic-gradient(from 0deg, rgba(232,192,106,.30) 0deg 5deg, rgba(232,192,106,0) 5deg 17deg);
  animation: lel-gift-spin 22s linear infinite;
}
.lel-gift--open .lel-gift__rays, .lel-gift--revealed .lel-gift__rays { opacity: 1; transform: scale(1); }

/* The book, hidden in the box, then rising out of it */
.lel-gift__book {
  position: absolute; left: 50%; bottom: 44px; width: 132px; height: 211px; margin-left: -66px;
  border-radius: 4px 7px 7px 4px; z-index: 1; opacity: 0;
  transform: translateY(0) scale(.62); transform-origin: 50% 100%;
  box-shadow: 0 18px 40px rgba(0,0,0,.45), inset 3px 0 0 rgba(255,255,255,.12);
}
.lel-gift--open .lel-gift__book {
  opacity: 1; animation: lel-gift-rise 1.3s cubic-bezier(.2,.9,.25,1.15) .15s both;
}
.lel-gift--revealed .lel-gift__book {
  opacity: 1; transform: translateY(-132px) scale(1);
  filter: drop-shadow(0 0 22px rgba(232,192,106,.45));
  animation: lel-gift-float 4s ease-in-out infinite;
}

/* The parcel */
.lel-gift__parcel {
  position: absolute; left: 50%; bottom: 18px; width: 190px; height: 190px; margin-left: -95px;
  background: none; border: 0; padding: 0; z-index: 2; cursor: pointer;
}
.lel-gift__parcel:disabled { cursor: default; }
.lel-gift--arrive .lel-gift__parcel { animation: lel-gift-drop .95s cubic-bezier(.3,1.4,.5,1) both; }
.lel-gift--waiting .lel-gift__parcel { animation: lel-gift-wiggle 1.6s ease-in-out .2s infinite; }
.lel-gift--revealed .lel-gift__parcel { animation: lel-gift-sink .45s ease-in both; }
/* Opened, the parcel sinks out of sight onto the button: it must not take its taps (26 Nov 2026). */
.lel-gift--open .lel-gift__parcel, .lel-gift--revealed .lel-gift__parcel { pointer-events: none; }
.lel-gift__box {
  position: absolute; left: 10px; right: 10px; bottom: 0; height: 128px; border-radius: 6px 6px 12px 12px;
  background: linear-gradient(180deg, #243253 0%, #121f3c 55%, #101728 100%);
  box-shadow: 0 22px 40px rgba(0,0,0,.45), inset 0 -10px 18px rgba(0,0,0,.25), inset 0 2px 0 rgba(255,255,255,.06);
}
.lel-gift__lid {
  position: absolute; left: 0; right: 0; bottom: 122px; height: 44px; border-radius: 6px;
  background: linear-gradient(180deg, #344364 0%, #1b2948 100%);
  box-shadow: 0 6px 12px rgba(0,0,0,.35), inset 0 2px 0 rgba(255,255,255,.08);
  transform-origin: 30% 100%;
}
.lel-gift--open .lel-gift__lid, .lel-gift--revealed .lel-gift__lid {
  animation: lel-gift-lid .9s cubic-bezier(.25,.6,.3,1) both;
}
.lel-gift__ribbon {
  position: absolute; top: 0; bottom: 0; left: 50%; width: 26px; margin-left: -13px;
  background: linear-gradient(90deg, #b8862f, #f0cf7f 45%, #c9973a);
}
.lel-gift__bow { position: absolute; left: 50%; top: -30px; width: 0; height: 0; }
.lel-gift__loop {
  position: absolute; top: 0; width: 46px; height: 34px; border: 9px solid #e1b55b; border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%;
  box-shadow: inset 0 0 0 1px rgba(120,80,20,.25);
}
.lel-gift__loop--left { right: 2px; transform: rotate(-24deg); transform-origin: 100% 100%; }
.lel-gift__loop--right { left: 2px; transform: rotate(24deg); transform-origin: 0 100%; }
.lel-gift__knot {
  position: absolute; top: 18px; left: -12px; width: 24px; height: 18px; border-radius: 6px;
  background: linear-gradient(180deg, #f0cf7f, #c9973a);
}

/* Confetti */
.lel-gift__confetti { position: absolute; left: 50%; top: 236px; width: 0; height: 0; z-index: 3; }
.lel-gift__confetti span {
  position: absolute; left: 0; top: 0; opacity: 0;
  animation: lel-gift-confetti var(--dur) cubic-bezier(.15,.7,.35,1) var(--delay) both;
}

/* Sparkles around the book */
.lel-gift__sparkle { position: absolute; z-index: 3; color: #f0cf7f; opacity: 0; font-size: 18px; }
.lel-gift__sparkle--1 { left: 26px; top: 70px; }
.lel-gift__sparkle--2 { right: 22px; top: 120px; font-size: 14px; }
.lel-gift__sparkle--3 { right: 54px; top: 22px; font-size: 22px; }
.lel-gift--revealed .lel-gift__sparkle { animation: lel-gift-twinkle 2.4s ease-in-out infinite; }
.lel-gift--revealed .lel-gift__sparkle--2 { animation-delay: .8s; }
.lel-gift--revealed .lel-gift__sparkle--3 { animation-delay: 1.5s; }

/* Text */
.lel-gift__text {
  position: relative; z-index: 4; width: 100%; max-width: 380px; min-height: 196px; text-align: center;
  transition: margin-top .7s cubic-bezier(.2,.8,.2,1) .3s;
}
.lel-gift--revealed .lel-gift__text { margin-top: -150px; }
.lel-gift__hint {
  position: absolute; left: 0; right: 0; top: 8px; margin: 0;
  font-size: 15px; color: rgba(243,236,221,.75); opacity: 0; transition: opacity .4s;
}
.lel-gift--waiting .lel-gift__hint { opacity: 1; animation: lel-gift-pulse 1.6s ease-in-out infinite; }
.lel-gift__message { opacity: 0; transform: translateY(14px); pointer-events: none; }
.lel-gift--revealed .lel-gift__message {
  opacity: 1; transform: none; pointer-events: auto; transition: opacity .6s ease-out .55s, transform .6s ease-out .55s;
}
.lel-gift__kicker {
  margin: 0; font-size: 12px; font-weight: 700; letter-spacing: .2em; text-transform: uppercase; color: rgba(232,239,255,.85);
}
.lel-gift__title {
  margin: 6px 0 8px; font-family: ui-serif, Georgia, 'Times New Roman', serif; font-size: 40px; font-weight: 700; line-height: 1.05; color: #f3ecdd;
}
.lel-gift__by { margin: 0 0 4px; font-size: 15px; line-height: 1.45; color: rgba(243,236,221,.8); }
.lel-gift__cta {
  margin-top: 18px; padding: 13px 26px; border: 0; border-radius: 999px; cursor: pointer;
  background: #f3ecdd; color: #101728; font-size: 16px; font-weight: 700;
  box-shadow: 0 10px 24px rgba(0,0,0,.3); transition: transform .15s ease, background .15s ease;
}
.lel-gift__cta:hover { background: #fff8ea; transform: translateY(-1px); }
.lel-gift__cta:focus-visible { outline: 3px solid #e8c06a; outline-offset: 3px; }

@keyframes lel-gift-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes lel-gift-spin { to { transform: rotate(360deg) } }
@keyframes lel-gift-drop {
  0% { transform: translateY(-520px) rotate(-8deg); }
  70% { transform: translateY(0) rotate(2deg) scale(1.04, .94); }
  85% { transform: translateY(-14px) rotate(-1deg); }
  100% { transform: translateY(0) rotate(0); }
}
@keyframes lel-gift-wiggle {
  0%, 55%, 100% { transform: rotate(0) }
  62% { transform: rotate(-6deg) translateY(-4px) }
  70% { transform: rotate(6deg) translateY(-6px) }
  78% { transform: rotate(-4deg) translateY(-3px) }
  86% { transform: rotate(3deg) }
  93% { transform: rotate(-1deg) }
}
@keyframes lel-gift-lid {
  0% { transform: translate(0,0) rotate(0); opacity: 1; }
  25% { transform: translate(-6px,-26px) rotate(-6deg); opacity: 1; }
  100% { transform: translate(-150px,-260px) rotate(-62deg); opacity: 0; }
}
@keyframes lel-gift-rise {
  0% { transform: translateY(0) scale(.62); }
  65% { transform: translateY(-160px) scale(1.06); }
  100% { transform: translateY(-132px) scale(1); }
}
@keyframes lel-gift-float {
  0%, 100% { transform: translateY(-132px) scale(1) rotate(0); }
  50% { transform: translateY(-140px) scale(1) rotate(-.6deg); }
}
@keyframes lel-gift-sink {
  to { transform: translateY(90px) scale(.9); opacity: 0; }
}
@keyframes lel-gift-confetti {
  0% { transform: translate(0,0) rotate(0); opacity: 1; }
  55% { transform: translate(var(--x), var(--y)) rotate(calc(var(--rot) * .6)); opacity: 1; }
  100% { transform: translate(calc(var(--x) * 1.15), calc(var(--y) + var(--fall))) rotate(var(--rot)); opacity: 0; }
}
@keyframes lel-gift-twinkle {
  0%, 100% { opacity: 0; transform: scale(.6) rotate(0); }
  50% { opacity: 1; transform: scale(1.15) rotate(25deg); }
}
@keyframes lel-gift-pulse { 0%, 100% { opacity: .55 } 50% { opacity: 1 } }

@media (prefers-reduced-motion: reduce) {
  .lel-gift, .lel-gift * { animation: none !important; transition: none !important; }
  .lel-gift--revealed .lel-gift__book { transform: translateY(-132px) scale(1); }
  .lel-gift--revealed .lel-gift__parcel { opacity: 0; }
  .lel-gift__confetti { display: none; }
}
`;

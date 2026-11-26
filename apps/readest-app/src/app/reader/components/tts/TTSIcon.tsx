import clsx from 'clsx';
import React from 'react';
import { useTranslation } from '@/hooks/useTranslation';

type TTSIconProps = {
  isPlaying: boolean;
  ttsInited: boolean;
  onClick: () => void;
};

const TTSIcon: React.FC<TTSIconProps> = ({ isPlaying, ttsInited, onClick }) => {
  const _ = useTranslation();
  const bars = [1, 2, 3, 4];

  return (
    <button
      type='button'
      aria-label={_('Read Aloud')}
      className={clsx(
        'relative h-full w-full rounded-full',
        ttsInited ? 'cursor-pointer' : 'cursor-not-allowed',
      )}
      style={{
        maskImage: 'radial-gradient(circle, white 100%, transparent 100%)',
        WebkitMaskImage: 'radial-gradient(circle, white 100%, transparent 100%)',
      }}
      onClick={onClick}
    >
      {/* The app's midnight blue, with a soft ring that breathes while the voice reads. */}
      <div
        className='absolute inset-0 overflow-hidden rounded-full bg-[#e8c06a] shadow-[0_10px_26px_-6px_rgba(150,110,30,0.6)]'
        style={{
          animation: isPlaying && ttsInited ? 'ttsBreathe 2.4s ease-in-out infinite' : 'none',
        }}
      />

      <div className='absolute inset-0 flex items-center justify-center'>
        <style>{`
          @keyframes ttsBreathe {
            0%, 100% { box-shadow: 0 8px 20px rgba(0,0,0,0.25), 0 0 0 0 rgba(242,193,78,0.55); }
            50% { box-shadow: 0 8px 20px rgba(0,0,0,0.25), 0 0 0 8px rgba(242,193,78,0); }
          }
          @keyframes bounce {
            0%, 100% { transform: scaleY(1); }
            50% { transform: scaleY(0.6); }
          }
        `}</style>
        <div className='flex items-end space-x-1'>
          {bars.map((bar) => (
            <div
              key={bar}
              className='w-1 rounded-full bg-[#101728]'
              style={{
                height: '16px',
                animationName: isPlaying ? 'bounce' : 'none',
                animationDuration: isPlaying ? `${1 + bar * 0.1}s` : '0s',
                animationTimingFunction: 'ease-in-out',
                animationIterationCount: 'infinite',
                animationDelay: `${bar * 0.1}s`,
              }}
            />
          ))}
        </div>
      </div>
    </button>
  );
};

export default TTSIcon;

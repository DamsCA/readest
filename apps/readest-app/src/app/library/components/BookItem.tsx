import clsx from 'clsx';
import {
  IconChecked,
  IconDownload,
  IconInfo,
  IconUnchecked,
  IconUpload,
} from '@/components/icons/lisetlead';
import { READEST_CLOUD_ENABLED } from '@/services/features';
import { useEffect, useState } from 'react';

import { Book } from '@/types/book';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { LibraryCoverFitType, LibraryViewModeType } from '@/types/settings';
import { navigateToLogin } from '@/utils/nav';
import { formatAuthors, formatDescription, formatSeries } from '@/utils/book';
import ReadingProgress from './ReadingProgress';
import BookCover from '@/components/BookCover';

interface BookItemProps {
  book: Book;
  mode: LibraryViewModeType;
  coverFit: LibraryCoverFitType;
  isSelectMode: boolean;
  bookSelected: boolean;
  transferProgress: number | null;
  handleBookUpload: (book: Book) => void;
  handleBookDownload: (book: Book, options?: { redownload?: boolean; queued?: boolean }) => void;
  showBookDetailsModal: (book: Book) => void;
}

const BookItem: React.FC<BookItemProps> = ({
  book,
  mode,
  coverFit,
  isSelectMode,
  bookSelected,
  transferProgress,
  handleBookUpload,
  handleBookDownload,
  showBookDetailsModal,
}) => {
  const _ = useTranslation();
  const router = useRouter();
  const { user } = useAuth();
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const iconSize15 = useResponsiveSize(15);

  const [coverAspect, setCoverAspect] = useState<number | null>(null);
  useEffect(() => {
    setCoverAspect(null);
  }, [book.hash, book.metadata?.coverImageUrl, book.coverImageUrl]);

  const CELL_ASPECT_RATIO = 28 / 41;
  const fitCoverInGrid = mode === 'grid' && coverFit === 'fit' && coverAspect !== null;
  const shouldShrinkWidth = fitCoverInGrid && coverAspect! < CELL_ASPECT_RATIO;
  const bookitemMainStyle = fitCoverInGrid
    ? {
        aspectRatio: coverAspect!,
        ...(shouldShrinkWidth ? { width: `${(coverAspect! / CELL_ASPECT_RATIO) * 100}%` } : {}),
      }
    : undefined;

  const seriesText = formatSeries(book.metadata?.series, book.metadata?.seriesIndex);

  return (
    <div
      role='none'
      className={clsx(
        'book-item flex',
        // Grid: a soft card around the cover, title and progress.
        mode === 'grid' && 'bg-base-100 h-full flex-col justify-end rounded-3xl p-2.5',
        mode === 'list' && 'min-h-28 flex-row gap-4 overflow-hidden',
        mode === 'list' ? 'library-list-item' : 'library-grid-item',
        appService?.hasContextMenu ? 'cursor-pointer' : '',
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className={clsx(
          'bookitem-main relative flex justify-center overflow-hidden',
          mode === 'grid' ? 'rounded-2xl' : 'rounded',
          !fitCoverInGrid && 'aspect-[28/41]',
          coverFit === 'crop' && mode === 'list' && 'shadow-md',
          mode === 'grid' && 'items-end',
          mode === 'list' && 'min-w-20 items-center',
        )}
        style={bookitemMainStyle}
      >
        <BookCover
          mode={mode}
          book={book}
          coverFit={coverFit}
          showSpine={false}
          imageClassName={mode === 'grid' ? 'rounded-2xl' : 'rounded shadow-md'}
          onAspectRatioChange={setCoverAspect}
        />
        {bookSelected && (
          <div className='absolute inset-0 bg-black opacity-30 transition-opacity duration-300'></div>
        )}
        {isSelectMode && (
          <div className='absolute bottom-1 right-1'>
            {bookSelected ? (
              <IconChecked className='fill-blue-500' />
            ) : (
              <IconUnchecked className='fill-gray-300 drop-shadow-sm' />
            )}
          </div>
        )}
      </div>
      <div
        className={clsx(
          'flex w-full flex-col p-0',
          mode === 'grid' && 'px-1 pt-2.5',
          mode === 'list' && 'gap-1 py-0',
        )}
      >
        <div className={clsx('min-w-0 flex-1', mode === 'list' && 'flex flex-col gap-1')}>
          <h4
            className={clsx(
              'overflow-hidden text-ellipsis font-semibold',
              mode === 'grid' && 'block whitespace-nowrap text-sm leading-5',
              mode === 'list' && 'line-clamp-1 text-base',
            )}
          >
            {book.title}
          </h4>
          <p
            className={clsx(
              'text-neutral-content line-clamp-1',
              mode === 'grid' ? 'text-xs leading-5' : 'text-sm',
            )}
          >
            {formatAuthors(book.author, book.primaryLanguage) || ''}
          </p>
        </div>
        {mode === 'list' && seriesText && (
          <p className='text-neutral-content line-clamp-1 text-sm'>{seriesText}</p>
        )}
        {mode === 'list' && (
          <h4 className='text-neutral-content line-clamp-1 text-sm'>
            {formatDescription(book.metadata?.description)}
          </h4>
        )}
        <div
          className={clsx(
            'flex items-center',
            book.progress || book.readingStatus ? 'justify-between' : 'justify-end',
          )}
          style={{
            height: `${iconSize15}px`,
            minHeight: `${iconSize15}px`,
          }}
        >
          {(book.progress || book.readingStatus) && <ReadingProgress book={book} />}
          <div className='flex items-center justify-center gap-x-2'>
            {!appService?.isMobile && (
              <button
                aria-label={_('Show Book Details')}
                className='show-detail-button -m-2 p-2 sm:opacity-0 sm:group-hover:opacity-100'
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => {
                  showBookDetailsModal(book);
                }}
              >
                <div className='pt-[2px] sm:pt-[1px]'>
                  <IconInfo size={iconSize15} />
                </div>
              </button>
            )}
            {transferProgress !== null ? (
              transferProgress === 100 ? null : (
                <div
                  className='radial-progress'
                  style={
                    {
                      '--value': transferProgress,
                      '--size': `${iconSize15}px`,
                      '--thickness': '2px',
                    } as React.CSSProperties
                  }
                  role='progressbar'
                ></div>
              )
            ) : (
              READEST_CLOUD_ENABLED &&
              (!book.uploadedAt || (book.uploadedAt && !book.downloadedAt)) && (
                <button
                  aria-label={!book.uploadedAt ? _('Upload Book') : _('Download Book')}
                  className='show-cloud-button -m-2 p-2'
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    if (!user) {
                      navigateToLogin(router);
                      return;
                    }
                    if (!book.uploadedAt) {
                      handleBookUpload(book);
                    } else if (!book.downloadedAt) {
                      handleBookDownload(book, { queued: true });
                    }
                  }}
                >
                  {!book.uploadedAt && settings.autoUpload && <IconUpload size={iconSize15} />}
                  {book.uploadedAt && !book.downloadedAt && <IconDownload size={iconSize15} />}
                </button>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BookItem;

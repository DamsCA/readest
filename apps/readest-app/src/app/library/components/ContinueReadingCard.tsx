import clsx from 'clsx';
import { IconListen } from '@/components/icons/lisetlead';
import { Book } from '@/types/book';
import { useThemeStore } from '@/store/themeStore';
import { useTranslation } from '@/hooks/useTranslation';
import { formatAuthors } from '@/utils/book';
import BookCover from '@/components/BookCover';
import { getReadFraction } from '../utils/continueReading';

interface ContinueReadingCardProps {
  book: Book;
  onOpen: (book: Book) => void;
  onListen: (book: Book) => void;
}

/**
 * The big card at the top of the library: the book being read, its cover
 * tilted on the side, how far the reader got, and one tap to go back in.
 * The blue is deeper at night so the card never glows in a dark room.
 */
const ContinueReadingCard: React.FC<ContinueReadingCardProps> = ({ book, onOpen, onListen }) => {
  const _ = useTranslation();
  const { isDarkMode } = useThemeStore();
  const percent = Math.round((getReadFraction(book) ?? 0) * 100);
  const authors = formatAuthors(book.author, book.primaryLanguage);

  return (
    <section
      aria-label={_('Continue Reading')}
      className={clsx(
        'relative mx-4 mb-2 mt-2 flex h-64 flex-col overflow-hidden rounded-[2rem] p-5',
        'text-[#F4F7FD]',
        isDarkMode ? 'border border-white/5 bg-[#061741]' : 'bg-[#223B78]',
      )}
    >
      <span className='self-start rounded-full bg-white/15 px-3 py-1.5 text-xs font-bold'>
        {_('Continue Reading')}
      </span>
      <h2 className='font-display mt-3 line-clamp-2 max-w-[58%] text-[1.75rem] font-bold leading-[1.05] tracking-tight'>
        {book.title}
      </h2>
      {authors && (
        <p className='mt-1.5 line-clamp-1 max-w-[58%] text-sm text-[#E6EDFF]'>{authors}</p>
      )}
      <div className='mt-auto flex max-w-[50%] flex-col gap-2'>
        <div
          role='progressbar'
          aria-label={_('Reading Progress')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className='h-2.5 rounded-full bg-white/20'
        >
          <div
            className='h-2.5 rounded-full bg-[#F2C14E] transition-[width] duration-500'
            style={{ width: `${Math.max(percent, 4)}%` }}
          />
        </div>
        <span className='text-xs font-semibold text-[#E6EDFF]'>
          {_('{{percent}}% read', { percent })}
        </span>
      </div>
      <div
        aria-hidden='true'
        className='pointer-events-none absolute right-3 top-4 w-28 rotate-[8deg] overflow-hidden rounded-[4px_12px_12px_4px] shadow-[0_16px_30px_rgba(0,0,0,0.35)]'
      >
        <div className='aspect-[28/41]'>
          <BookCover mode='grid' book={book} coverFit='crop' showSpine={false} />
        </div>
      </div>
      <div className='absolute bottom-5 right-5 flex gap-2'>
        <button
          type='button'
          aria-label={_('Listen')}
          title={_('Listen')}
          onClick={() => onListen(book)}
          className='flex h-12 w-12 items-center justify-center rounded-full bg-[#F2C14E] text-[#3A2A06] transition-transform active:scale-95'
        >
          <IconListen aria-hidden='true' className='h-5 w-5' />
        </button>
        <button
          type='button'
          onClick={() => onOpen(book)}
          className='flex h-12 items-center rounded-full bg-white px-6 text-[15px] font-bold text-[#040F28] transition-transform active:scale-95'
        >
          {_('Read')}
        </button>
      </div>
    </section>
  );
};

export default ContinueReadingCard;

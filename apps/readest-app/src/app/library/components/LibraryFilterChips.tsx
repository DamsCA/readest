import clsx from 'clsx';
import { ArrowDownUp } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import Dropdown from '@/components/Dropdown';
import { LIBRARY_FILTERS, LibraryFilter } from '../utils/continueReading';
import ViewMenu from './ViewMenu';

interface LibraryFilterChipsProps {
  filter: LibraryFilter;
  onChange: (filter: LibraryFilter) => void;
}

/** Round chips to narrow the shelf, then the sort and display menu. */
const LibraryFilterChips: React.FC<LibraryFilterChipsProps> = ({ filter, onChange }) => {
  const _ = useTranslation();
  const labels: Record<LibraryFilter, string> = {
    all: _('All'),
    reading: _('Reading'),
    epub: 'EPUB',
    pdf: 'PDF',
  };

  return (
    <div className='flex items-center gap-2 px-4 pb-3 pt-3'>
      <div
        role='group'
        aria-label={_('Filter Books')}
        className='no-scrollbar flex min-w-0 flex-1 gap-2 overflow-x-auto'
      >
        {LIBRARY_FILTERS.map((value) => {
          const selected = value === filter;
          return (
            <button
              key={value}
              type='button'
              aria-pressed={selected}
              onClick={() => onChange(value)}
              className={clsx(
                'h-11 shrink-0 rounded-full px-4 text-sm transition-colors',
                selected
                  ? 'bg-base-content text-base-100 font-bold'
                  : 'bg-base-100 text-base-content font-semibold',
              )}
            >
              {labels[value]}
            </button>
          );
        })}
      </div>
      <Dropdown
        label={_('View Menu')}
        className='dropdown-bottom dropdown-end'
        buttonClassName='bg-base-100 text-base-content flex h-11 w-11 items-center justify-center rounded-full p-0'
        toggleButton={<ArrowDownUp role='none' className='h-5 w-5' />}
      >
        <ViewMenu />
      </Dropdown>
    </div>
  );
};

export default LibraryFilterChips;

import { IconType } from 'react-icons';
import {
  IconAnnotate,
  IconCopy,
  IconDictionary,
  IconHighlight,
  IconListen,
  IconSearch,
  IconShare,
  IconTools,
  IconTranslate,
} from '@/components/icons/lisetlead';
import { AnnotationToolType } from '@/types/annotator';
import { stubTranslation as _ } from '@/utils/misc';

type AnnotationToolButton = {
  type: AnnotationToolType;
  label: string;
  tooltip: string;
  Icon: IconType;
  quickAction?: boolean;
};

function createAnnotationToolButtons<T extends AnnotationToolType>(
  buttons: AnnotationToolType extends T
    ? {
        [K in T]: {
          type: K;
          label: string;
          tooltip: string;
          Icon: IconType;
          quickAction?: boolean;
        };
      }[T][]
    : never,
): AnnotationToolButton[] {
  return buttons;
}

export const annotationToolButtons = createAnnotationToolButtons([
  {
    type: 'copy',
    label: _('Copy'),
    tooltip: _('Copy text after selection'),
    Icon: IconCopy,
    quickAction: true,
  },
  {
    type: 'highlight',
    label: _('Highlight'),
    tooltip: _('Highlight text after selection'),
    Icon: IconHighlight,
    quickAction: true,
  },
  {
    type: 'annotate',
    label: _('Annotate'),
    tooltip: _('Annotate text after selection'),
    Icon: IconAnnotate,
  },
  {
    type: 'search',
    label: _('Search'),
    tooltip: _('Search text after selection'),
    Icon: IconSearch,
    quickAction: true,
  },
  {
    type: 'dictionary',
    label: _('Dictionary'),
    tooltip: _('Look up text in dictionary after selection'),
    Icon: IconDictionary,
    quickAction: true,
  },
  {
    type: 'translate',
    label: _('Translate'),
    tooltip: _('Translate text after selection'),
    Icon: IconTranslate,
    quickAction: true,
  },
  {
    type: 'tts',
    label: _('Speak'),
    tooltip: _('Read text aloud after selection'),
    Icon: IconListen,
    quickAction: true,
  },
  {
    type: 'proofread',
    label: _('Proofread'),
    tooltip: _('Proofread text after selection'),
    Icon: IconTools,
  },
  {
    type: 'share',
    label: _('Share'),
    tooltip: _('Share text after selection'),
    Icon: IconShare,
    quickAction: true,
  },
]);

export const annotationToolQuickActions = annotationToolButtons.filter(
  (button) => button.quickAction,
);

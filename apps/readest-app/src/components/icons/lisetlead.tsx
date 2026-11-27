import clsx from 'clsx';
import type { IconBaseProps, IconType } from 'react-icons';
import {
  PiArrowsClockwiseDuotone,
  PiArrowsDownUpDuotone,
  PiArrowsOutLineVerticalDuotone,
  PiArrowSquareOutDuotone,
  PiArrowUUpLeftDuotone,
  PiArrowUUpRightDuotone,
  PiBookBookmarkDuotone,
  PiBookmarkSimpleDuotone,
  PiBookmarkSimpleFill,
  PiBookOpenTextDuotone,
  PiBooksDuotone,
  PiCaretDoubleLeftDuotone,
  PiCaretDoubleRightDuotone,
  PiCaretDownDuotone,
  PiCaretLeftBold,
  PiCaretLeftDuotone,
  PiCaretRightDuotone,
  PiCaretUpDuotone,
  PiChatCircleDuotone,
  PiCheckBold,
  PiCheckCircleDuotone,
  PiCheckCircleFill,
  PiCheckSquareDuotone,
  PiCircleDuotone,
  PiCircleHalfDuotone,
  PiCloudArrowDownDuotone,
  PiCloudArrowUpDuotone,
  PiCloudWarningDuotone,
  PiCompassDuotone,
  PiCopyDuotone,
  PiEyedropperDuotone,
  PiFastForwardDuotone,
  PiFileArrowUpDuotone,
  PiFileDuotone,
  PiFolderDuotone,
  PiFolderMinusDuotone,
  PiFolderOpenDuotone,
  PiFolderPlusDuotone,
  PiFrameCornersDuotone,
  PiGearSixDuotone,
  PiGlobeDuotone,
  PiHandPointingDuotone,
  PiHeadphonesDuotone,
  PiHighlighterDuotone,
  PiInfoDuotone,
  PiLayoutDuotone,
  PiLinkDuotone,
  PiListBulletsDuotone,
  PiListDuotone,
  PiMagnifyingGlassDuotone,
  PiMinusBold,
  PiMoonDuotone,
  PiNotePencilDuotone,
  PiPaletteDuotone,
  PiPauseFill,
  PiPencilSimpleDuotone,
  PiPenNibDuotone,
  PiPersonArmsSpreadDuotone,
  PiPlayFill,
  PiPlusBold,
  PiPushPinDuotone,
  PiPushPinFill,
  PiRadioButtonFill,
  PiRewindDuotone,
  PiSelectionDuotone,
  PiShareNetworkDuotone,
  PiSkipBackDuotone,
  PiSkipForwardDuotone,
  PiSlidersHorizontalDuotone,
  PiSparkleDuotone,
  PiSpeakerHighDuotone,
  PiSpeakerLowDuotone,
  PiSunDuotone,
  PiTextAlignLeftDuotone,
  PiTranslateDuotone,
  PiTrashDuotone,
  PiUserCircleCheckDuotone,
  PiUserCircleDuotone,
  PiWarningCircleDuotone,
  PiWrenchDuotone,
  PiXBold,
  PiXCircleDuotone,
} from 'react-icons/pi';

// Lis et Lead's own icons. Asked 23 Nov 2026: « tous les interfaces… ressemblent
// beaucoup trop à Readest… même au niveau des icônes… des lettres ». Readest
// mixes thin line icons from four families (Material, Ionicons, Remix, Lucide)
// and draws letters (« Aa », « T », « A A ») for its reading settings. Here one
// family, Phosphor, and pictures instead of letters. Since 27 Nov 2026 they are
// drawn with their line only: the gold filling of the two-tone icons is hidden
// (globals.css, .lel-icon; the owner found it « vraiment moche »).
const brand = (Icon: IconType, name: string): IconType => {
  const Branded = (props: IconBaseProps) => (
    <Icon {...props} className={clsx('lel-icon', props.className)} />
  );
  Branded.displayName = name;
  return Branded;
};

// Moving around.
export const IconBack = brand(PiCaretLeftBold, 'IconBack');
export const IconClose = brand(PiXBold, 'IconClose');
export const IconPrevious = brand(PiCaretLeftDuotone, 'IconPrevious');
export const IconNext = brand(PiCaretRightDuotone, 'IconNext');
export const IconFirst = brand(PiCaretDoubleLeftDuotone, 'IconFirst');
export const IconLast = brand(PiCaretDoubleRightDuotone, 'IconLast');
export const IconUndo = brand(PiArrowUUpLeftDuotone, 'IconUndo');
export const IconRedo = brand(PiArrowUUpRightDuotone, 'IconRedo');
export const IconExpand = brand(PiCaretDownDuotone, 'IconExpand');
export const IconCollapse = brand(PiCaretUpDuotone, 'IconCollapse');

// The library.
export const IconLibrary = brand(PiBooksDuotone, 'IconLibrary');
export const IconReading = brand(PiBookOpenTextDuotone, 'IconReading');
export const IconSettings = brand(PiGearSixDuotone, 'IconSettings');
export const IconMenu = brand(PiListDuotone, 'IconMenu');
export const IconPlus = brand(PiPlusBold, 'IconPlus');
export const IconSearch = brand(PiMagnifyingGlassDuotone, 'IconSearch');
export const IconSort = brand(PiArrowsDownUpDuotone, 'IconSort');
export const IconSelect = brand(PiSelectionDuotone, 'IconSelect');
export const IconSelected = brand(PiCheckSquareDuotone, 'IconSelected');
export const IconFromFile = brand(PiFileArrowUpDuotone, 'IconFromFile');
export const IconOnlineLibrary = brand(PiGlobeDuotone, 'IconOnlineLibrary');
export const IconLink = brand(PiLinkDuotone, 'IconLink');
export const IconUser = brand(PiUserCircleDuotone, 'IconUser');
export const IconUserChecked = brand(PiUserCircleCheckDuotone, 'IconUserChecked');
export const IconSun = brand(PiSunDuotone, 'IconSun');
export const IconMoon = brand(PiMoonDuotone, 'IconMoon');
export const IconAutoTheme = brand(PiCircleHalfDuotone, 'IconAutoTheme');
export const IconCloudSync = brand(PiCloudArrowUpDuotone, 'IconCloudSync');
export const IconSync = brand(PiArrowsClockwiseDuotone, 'IconSync');
export const IconSyncProblem = brand(PiCloudWarningDuotone, 'IconSyncProblem');
export const IconUpload = brand(PiCloudArrowUpDuotone, 'IconUpload');
export const IconDownload = brand(PiCloudArrowDownDuotone, 'IconDownload');
export const IconInfo = brand(PiInfoDuotone, 'IconInfo');
export const IconCheck = brand(PiCheckBold, 'IconCheck');
export const IconChecked = brand(PiCheckCircleFill, 'IconChecked');
export const IconUnchecked = brand(PiCheckCircleDuotone, 'IconUnchecked');

// Reading.
export const IconContents = brand(PiListBulletsDuotone, 'IconContents');
export const IconTheme = brand(PiPaletteDuotone, 'IconTheme');
export const IconProgress = brand(PiCompassDuotone, 'IconProgress');
export const IconText = brand(PiTextAlignLeftDuotone, 'IconText');
export const IconListen = brand(PiHeadphonesDuotone, 'IconListen');
export const IconTranslate = brand(PiTranslateDuotone, 'IconTranslate');
export const IconBookmark = brand(PiBookmarkSimpleDuotone, 'IconBookmark');
export const IconBookmarkFilled = brand(PiBookmarkSimpleFill, 'IconBookmarkFilled');
export const IconNotebook = brand(PiNotePencilDuotone, 'IconNotebook');
export const IconHighlight = brand(PiHighlighterDuotone, 'IconHighlight');
export const IconViewOptions = brand(PiSlidersHorizontalDuotone, 'IconViewOptions');
export const IconReadingSettings = brand(PiGearSixDuotone, 'IconReadingSettings');
export const IconMargins = brand(PiFrameCornersDuotone, 'IconMargins');
export const IconLineSpacing = brand(PiArrowsOutLineVerticalDuotone, 'IconLineSpacing');
export const IconChat = brand(PiChatCircleDuotone, 'IconChat');
export const IconPin = brand(PiPushPinDuotone, 'IconPin');
export const IconPinned = brand(PiPushPinFill, 'IconPinned');

// A selected passage.
export const IconCopy = brand(PiCopyDuotone, 'IconCopy');
export const IconAnnotate = brand(PiNotePencilDuotone, 'IconAnnotate');
export const IconDictionary = brand(PiBookBookmarkDuotone, 'IconDictionary');
export const IconShare = brand(PiShareNetworkDuotone, 'IconShare');
export const IconTools = brand(PiWrenchDuotone, 'IconTools');

// Listening.
export const IconPlay = brand(PiPlayFill, 'IconPlay');
export const IconPause = brand(PiPauseFill, 'IconPause');
export const IconRewind = brand(PiRewindDuotone, 'IconRewind');
export const IconFastForward = brand(PiFastForwardDuotone, 'IconFastForward');
export const IconSkipBack = brand(PiSkipBackDuotone, 'IconSkipBack');
export const IconSkipForward = brand(PiSkipForwardDuotone, 'IconSkipForward');
export const IconVolumeDown = brand(PiSpeakerLowDuotone, 'IconVolumeDown');
export const IconVolumeUp = brand(PiSpeakerHighDuotone, 'IconVolumeUp');

// The settings' sections.
export const IconFont = brand(PiPenNibDuotone, 'IconFont');
export const IconLayout = brand(PiLayoutDuotone, 'IconLayout');
export const IconControl = brand(PiHandPointingDuotone, 'IconControl');
export const IconAI = brand(PiSparkleDuotone, 'IconAI');
export const IconSpeaker = brand(PiSpeakerHighDuotone, 'IconSpeaker');
export const IconAccessibility = brand(PiPersonArmsSpreadDuotone, 'IconAccessibility');

// Actions on a book, choices.
export const IconOpen = brand(PiArrowSquareOutDuotone, 'IconOpen');
export const IconFolderPlus = brand(PiFolderPlusDuotone, 'IconFolderPlus');
export const IconTrash = brand(PiTrashDuotone, 'IconTrash');
export const IconCancel = brand(PiXCircleDuotone, 'IconCancel');
export const IconEdit = brand(PiPencilSimpleDuotone, 'IconEdit');
export const IconMinus = brand(PiMinusBold, 'IconMinus');
export const IconRadioOn = brand(PiRadioButtonFill, 'IconRadioOn');
export const IconRadioOff = brand(PiCircleDuotone, 'IconRadioOff');
export const IconColorPicker = brand(PiEyedropperDuotone, 'IconColorPicker');

// Folders and files.
export const IconFolder = brand(PiFolderDuotone, 'IconFolder');
export const IconFolderOpen = brand(PiFolderOpenDuotone, 'IconFolderOpen');
export const IconFolderMinus = brand(PiFolderMinusDuotone, 'IconFolderMinus');
export const IconFile = brand(PiFileDuotone, 'IconFile');
export const IconWarning = brand(PiWarningCircleDuotone, 'IconWarning');

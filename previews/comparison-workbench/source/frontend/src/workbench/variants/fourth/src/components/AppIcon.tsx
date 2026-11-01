import { View, type ColorValue, type ViewProps } from "react-native";
// Public per-icon exports avoid loading the complete catalogue in Metro.
import ArrowDown from "lucide-react-native/icons/arrow-down";
import ArrowLeft from "lucide-react-native/icons/arrow-left";
import ArrowLeftRight from "lucide-react-native/icons/arrow-left-right";
import ArrowRight from "lucide-react-native/icons/arrow-right";
import ArrowUp from "lucide-react-native/icons/arrow-up";
import Baby from "lucide-react-native/icons/baby";
import Bell from "lucide-react-native/icons/bell";
import BookOpen from "lucide-react-native/icons/book-open";
import Calendar from "lucide-react-native/icons/calendar";
import CalendarClock from "lucide-react-native/icons/calendar-clock";
import Camera from "lucide-react-native/icons/camera";
import ChartColumnIncreasing from "lucide-react-native/icons/chart-column-increasing";
import Check from "lucide-react-native/icons/check";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import ChevronUp from "lucide-react-native/icons/chevron-up";
import Circle from "lucide-react-native/icons/circle";
import CircleCheck from "lucide-react-native/icons/circle-check";
import CircleDot from "lucide-react-native/icons/circle-dot";
import CircleHelp from "lucide-react-native/icons/circle-question-mark";
import ClipboardCheck from "lucide-react-native/icons/clipboard-check";
import Clock from "lucide-react-native/icons/clock";
import Compass from "lucide-react-native/icons/compass";
import Ellipsis from "lucide-react-native/icons/ellipsis";
import Eye from "lucide-react-native/icons/eye";
import EyeOff from "lucide-react-native/icons/eye-off";
import FileText from "lucide-react-native/icons/file-text";
import History from "lucide-react-native/icons/rotate-ccw-clock";
import House from "lucide-react-native/icons/house";
import ImageIcon from "lucide-react-native/icons/image";
import Info from "lucide-react-native/icons/info";
import Keyboard from "lucide-react-native/icons/keyboard";
import Link2 from "lucide-react-native/icons/link-2";
import LockKeyhole from "lucide-react-native/icons/lock-keyhole";
import Mail from "lucide-react-native/icons/mail";
import MessageCircle from "lucide-react-native/icons/message-circle";
import Mic from "lucide-react-native/icons/mic";
import Moon from "lucide-react-native/icons/moon";
import NotebookPen from "lucide-react-native/icons/notebook-pen";
import PanelRight from "lucide-react-native/icons/panel-right";
import Paperclip from "lucide-react-native/icons/paperclip";
import Pencil from "lucide-react-native/icons/pencil";
import Plus from "lucide-react-native/icons/plus";
import Ruler from "lucide-react-native/icons/ruler";
import Search from "lucide-react-native/icons/search";
import Send from "lucide-react-native/icons/send";
import Settings from "lucide-react-native/icons/settings";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import Sparkles from "lucide-react-native/icons/sparkles";
import Sprout from "lucide-react-native/icons/sprout";
import Square from "lucide-react-native/icons/square";
import SquareCheck from "lucide-react-native/icons/square-check";
import Thermometer from "lucide-react-native/icons/thermometer";
import Trash2 from "lucide-react-native/icons/trash";
import TriangleAlert from "lucide-react-native/icons/triangle-alert";
import UserRound from "lucide-react-native/icons/user-round";
import Users from "lucide-react-native/icons/users";
import Utensils from "lucide-react-native/icons/utensils";
import X from "lucide-react-native/icons/x";
import { colors, iconTokens } from "../theme";
import { ConcernIcon } from "./icons/ConcernIcon";
import { OverviewIcon } from "./icons/OverviewIcon";
import { PreparationIcon } from "./icons/PreparationIcon";

// Keep aliases used by existing view models and Paper controls in one place.
const icons = {
  "home-outline": House,
  "message-text-outline": MessageCircle,
  "notebook-outline": NotebookPen,
  "link-variant": Link2,
  "clipboard-check-outline": ClipboardCheck,
  "clipboard-check": ClipboardCheck,
  "overview-outline": OverviewIcon,
  "concern-outline": ConcernIcon,
  "preparation-outline": PreparationIcon,
  "account-child-outline": Baby,
  "account-outline": UserRound,
  "account-group-outline": Users,
  "book-open-variant": BookOpen,
  "book-open-page-variant-outline": BookOpen,
  "cog-outline": Settings,
  "compass-outline": Compass,
  "dots-horizontal": Ellipsis,
  "page-layout-sidebar-right": PanelRight,
  "swap-horizontal": ArrowLeftRight,
  "chevron-down": ChevronDown,
  "chevron-up": ChevronUp,
  "menu-up": ChevronUp,
  "menu-down": ChevronDown,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  "arrow-left": ArrowLeft,
  "arrow-right": ArrowRight,
  "arrow-up": ArrowUp,
  "arrow-down": ArrowDown,
  "arrow-left-right": ArrowLeftRight,
  "checkbox-marked": SquareCheck,
  "checkbox-blank-outline": Square,
  "radiobox-marked": CircleDot,
  "radiobox-blank": Circle,
  "check": Check,
  "check-circle": CircleCheck,
  "close": X,
  "bell-outline": Bell,
  "calendar-month-outline": Calendar,
  "calendar": Calendar,
  "calendar-blank": Calendar,
  "calendar-outline": Calendar,
  "calendar-clock-outline": CalendarClock,
  "clock-outline": Clock,
  "clock-time-four-outline": Clock,
  "keyboard-outline": Keyboard,
  "keyboard": Keyboard,
  "magnify": Search,
  "send": Send,
  "star-four-points": Sparkles,
  "sprout": Sprout,
  "pencil": Pencil,
  "pencil-outline": Pencil,
  "weather-night": Moon,
  "chart-bar": ChartColumnIncreasing,
  "silverware-fork-knife": Utensils,
  "baby-face-outline": Baby,
  "thermometer": Thermometer,
  "ruler": Ruler,
  "file-document-outline": FileText,
  "image-outline": ImageIcon,
  "camera-outline": Camera,
  "microphone-outline": Mic,
  "paperclip": Paperclip,
  "history": History,
  "information-outline": Info,
  "help-circle": CircleHelp,
  "shield-check-outline": ShieldCheck,
  "email-outline": Mail,
  "lock-outline": LockKeyhole,
  "eye": Eye,
  "eye-off": EyeOff,
  "plus": Plus,
  "delete-outline": Trash2,
  "alert-outline": TriangleAlert,
} as const;

export type AppIconName = keyof typeof icons;

export function AppIcon({ name, size = iconTokens.navigation, color = colors.muted, importantForAccessibility }: {
  name: AppIconName; size?: number; color?: ColorValue;
  importantForAccessibility?: ViewProps["importantForAccessibility"];
}) {
  const Icon = icons[name];
  return <View testID={"svg-icon-" + name} aria-hidden accessible={false} importantForAccessibility={importantForAccessibility ?? "no-hide-descendants"}
    style={{ width: size, height: size, flexShrink: 0 }}>
    <Icon size={size} color={color} strokeWidth={iconTokens.strokeWidth} aria-hidden focusable={false} />
  </View>;
}

export function PaperSvgIcon({ name, size, color }: { name: string; size: number; color?: string }) {
  const resolved = Object.hasOwn(icons, name) ? name as AppIconName : "help-circle";
  return <AppIcon name={resolved} size={size} color={color} />;
}

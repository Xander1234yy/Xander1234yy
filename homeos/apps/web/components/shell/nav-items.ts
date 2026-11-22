import {
  Bot,
  CalendarHeart,
  Cpu,
  DoorOpen,
  Home,
  Settings,
  ShieldCheck,
  Tv,
  Workflow,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/kamers", label: "Kamers", icon: DoorOpen },
  { href: "/apparaten", label: "Apparaten", icon: Cpu },
  { href: "/energie", label: "Energie", icon: Zap },
  { href: "/entertainment", label: "Entertainment", icon: Tv },
  { href: "/beveiliging", label: "Beveiliging", icon: ShieldCheck },
  { href: "/jarvis", label: "Jarvis", icon: Bot },
  { href: "/automatiseringen", label: "Automatiseringen", icon: Workflow },
  { href: "/familie", label: "Familie", icon: CalendarHeart },
  { href: "/onderhoud", label: "Onderhoud", icon: Wrench },
  { href: "/instellingen", label: "Instellingen", icon: Settings },
];

export const MOBILE_PRIMARY = ["/", "/apparaten", "/energie", "/jarvis"];

export function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
}

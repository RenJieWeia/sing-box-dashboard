import type { IconName } from "../components/Icon";
import { loadStoredJson, removeStoredValue, saveStoredJson } from "../lib/storage";
import type { MessageKey } from "./translations";

export type DashboardCardId =
  | "uploadTraffic"
  | "downloadTraffic"
  | "traffic"
  | "topOutbound"
  | "status"
  | "connections"
  | "systemProxy"
  | "clashMode"
  | "profile";

export type DashboardCardPairGroup = "traffic" | "statistics";

export const DASHBOARD_CARDS: Record<
  DashboardCardId,
  {
    title: MessageKey;
    icon: IconName;
    desktop?: boolean;
    permanent?: boolean;
    pairGroup?: DashboardCardPairGroup;
  }
> = {
  uploadTraffic: { title: "Upload", icon: "upload", pairGroup: "traffic" },
  downloadTraffic: { title: "Download", icon: "download", pairGroup: "traffic" },
  traffic: { title: "Traffic", icon: "speed" },
  topOutbound: { title: "Top Outbounds", icon: "hub" },
  status: { title: "Status", icon: "bug_report", pairGroup: "statistics" },
  connections: { title: "Connections", icon: "cable", pairGroup: "statistics" },
  systemProxy: { title: "System HTTP Proxy", icon: "router", desktop: true },
  clashMode: { title: "Clash Mode", icon: "route" },
  profile: { title: "Profile", icon: "folder", desktop: true, permanent: true },
};

const DEFAULT_CARD_ORDER: DashboardCardId[] = [
  "uploadTraffic",
  "downloadTraffic",
  "traffic",
  "status",
  "connections",
  "topOutbound",
  "systemProxy",
  "clashMode",
  "profile",
];

export interface DashboardCardsConfig {
  enabled: string[];
  order: string[];
}

const STORAGE_KEY = "dashboard-cards";

export function isDashboardCardId(value: string): value is DashboardCardId {
  return value in DASHBOARD_CARDS;
}

export function dashboardCardIds(desktop: boolean): DashboardCardId[] {
  return DEFAULT_CARD_ORDER.filter((card) => desktop || DASHBOARD_CARDS[card].desktop !== true);
}

export function loadDashboardCardsConfig(desktop: boolean): DashboardCardsConfig {
  const defaults = dashboardCardIds(desktop);
  const known = new Set<string>(defaults);
  const parsed = loadStoredJson(STORAGE_KEY) as Partial<DashboardCardsConfig> | null;
  if (parsed) {
    let enabled = (Array.isArray(parsed.enabled) ? parsed.enabled : []).filter(
      (card): card is string => typeof card === "string" && known.has(card),
    );
    let order = (Array.isArray(parsed.order) ? parsed.order : []).filter(
      (card): card is string => typeof card === "string" && known.has(card),
    );
    order = mergeDefaultOrder(order, defaults);
    const enabledCards = new Set(enabled);
    for (const card of defaults) {
      if (DASHBOARD_CARDS[card].permanent && !enabledCards.has(card)) {
        enabled = orderedEnabledCards({ enabled: [...enabled, card], order });
        enabledCards.add(card);
      }
    }
    return { enabled, order };
  }
  return { enabled: [...defaults], order: [...defaults] };
}

function mergeDefaultOrder(order: string[], defaults: DashboardCardId[]): string[] {
  const merged = [...order];
  for (const card of defaults) {
    if (merged.includes(card)) {
      continue;
    }
    const defaultIndex = defaults.indexOf(card);
    let insertAt = merged.length;
    for (let index = defaultIndex + 1; index < defaults.length; index += 1) {
      const existing = merged.indexOf(defaults[index]);
      if (existing >= 0) {
        insertAt = existing;
        break;
      }
    }
    merged.splice(insertAt, 0, card);
  }
  return merged;
}

export function saveDashboardCardsConfig(config: DashboardCardsConfig) {
  saveStoredJson(STORAGE_KEY, config);
}

export function resetDashboardCardsConfig(desktop: boolean): DashboardCardsConfig {
  removeStoredValue(STORAGE_KEY);
  const defaults = dashboardCardIds(desktop);
  return { enabled: [...defaults], order: [...defaults] };
}

export function orderedEnabledCards(config: DashboardCardsConfig): string[] {
  const enabled = new Set(config.enabled);
  return config.order.filter((card) => enabled.has(card));
}

export function toggleCard(config: DashboardCardsConfig, card: string): DashboardCardsConfig {
  if (isDashboardCardId(card) && DASHBOARD_CARDS[card].permanent) {
    return config;
  }
  if (config.enabled.includes(card)) {
    return { ...config, enabled: config.enabled.filter((entry) => entry !== card) };
  }
  const enabled = orderedEnabledCards({ ...config, enabled: [...config.enabled, card] });
  return { ...config, enabled };
}

export function moveCard(
  config: DashboardCardsConfig,
  from: number,
  to: number,
): DashboardCardsConfig {
  const order = [...config.order];
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved);
  return { ...config, order };
}

export function groupCardRows(cards: string[]): string[][] {
  const pairGroupOf = (card: string) =>
    isDashboardCardId(card) ? DASHBOARD_CARDS[card].pairGroup : undefined;
  const rows: string[][] = [];
  let index = 0;
  while (index < cards.length) {
    const card = cards[index];
    const pairGroup = pairGroupOf(card);
    const next = cards[index + 1];
    if (pairGroup !== undefined && next !== undefined && pairGroupOf(next) === pairGroup) {
      rows.push([card, next]);
      index += 2;
      continue;
    }
    rows.push([card]);
    index += 1;
  }
  return rows;
}

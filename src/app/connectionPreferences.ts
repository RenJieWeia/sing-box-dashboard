import {
  CONNECTION_SORT_MODES,
  CONNECTION_STATES,
  CONNECTION_TIME_WINDOWS,
  DEFAULT_CONNECTION_FILTERS,
  TRAFFIC_DIMENSIONS,
  TRAFFIC_GROUP_SORT_MODES,
  type ConnectionFilters,
  type ConnectionSortMode,
  type ConnectionStateFilter,
  type ConnectionTimeWindow,
  type SortDirection,
  type TrafficDimension,
  type TrafficGroupSortMode,
} from "../lib/traffic";
import { loadStoredJson, saveStoredJson } from "../lib/storage";

const LEGACY_STATE_FILTER_KEY = "connection-state-filter";
const FILTERS_KEY = "connection-filters";
const VIEW_MODE_KEY = "connection-view";
const SORT_MODE_KEY = "connection-sort";
const SORT_DIRECTION_KEY = "connection-sort-direction";
const GROUP_DIMENSION_KEY = "connection-group-dimension";
const GROUP_SORT_KEY = "connection-group-sort";
const GROUP_DIRECTION_KEY = "connection-group-direction";

export type ConnectionViewMode = "list" | "analysis";

const VIEW_MODES: ConnectionViewMode[] = ["list", "analysis"];

export function loadConnectionFilters(): ConnectionFilters {
  const parsed = loadStoredJson(FILTERS_KEY);
  const filters: ConnectionFilters = { ...DEFAULT_CONNECTION_FILTERS };
  if (isRecord(parsed)) {
    if (isState(parsed.state)) {
      filters.state = parsed.state;
    }
    if (typeof parsed.network === "string") {
      filters.network = parsed.network;
    }
    if (typeof parsed.sourceIp === "string") {
      filters.sourceIp = parsed.sourceIp;
    }
    if (typeof parsed.inbound === "string") {
      filters.inbound = parsed.inbound;
    }
    if (typeof parsed.outbound === "string") {
      filters.outbound = parsed.outbound;
    }
    if (typeof parsed.rule === "string") {
      filters.rule = parsed.rule;
    }
    if (typeof parsed.process === "string") {
      filters.process = parsed.process;
    }
    if (typeof parsed.protocol === "string") {
      filters.protocol = parsed.protocol;
    }
    if (isWindow(parsed.window)) {
      filters.window = parsed.window;
    }
  }
  if (!isRecord(parsed)) {
    // Migrate the state filter stored by older versions.
    const legacyState = loadStoredJson(LEGACY_STATE_FILTER_KEY);
    if (isState(legacyState)) {
      filters.state = legacyState;
    }
  }
  return filters;
}

export function saveConnectionFilters(filters: ConnectionFilters): void {
  saveStoredJson(FILTERS_KEY, filters);
}

export function loadConnectionViewMode(): ConnectionViewMode {
  const value = loadStoredJson(VIEW_MODE_KEY);
  return VIEW_MODES.find((mode) => mode === value) ?? "list";
}

export function saveConnectionViewMode(mode: ConnectionViewMode): void {
  saveStoredJson(VIEW_MODE_KEY, mode);
}

export function loadConnectionSortMode(): ConnectionSortMode {
  const value = loadStoredJson(SORT_MODE_KEY);
  return CONNECTION_SORT_MODES.find((mode) => mode === value) ?? "date";
}

export function saveConnectionSortMode(mode: ConnectionSortMode): void {
  saveStoredJson(SORT_MODE_KEY, mode);
}

export function loadConnectionSortDirection(): SortDirection {
  return loadStoredJson(SORT_DIRECTION_KEY) === "asc" ? "asc" : "desc";
}

export function saveConnectionSortDirection(direction: SortDirection): void {
  saveStoredJson(SORT_DIRECTION_KEY, direction);
}

export function loadConnectionGroupDimension(): TrafficDimension {
  const value = loadStoredJson(GROUP_DIMENSION_KEY);
  return TRAFFIC_DIMENSIONS.find((dimension) => dimension === value) ?? "outbound";
}

export function saveConnectionGroupDimension(dimension: TrafficDimension): void {
  saveStoredJson(GROUP_DIMENSION_KEY, dimension);
}

export function loadConnectionGroupSort(): TrafficGroupSortMode {
  const value = loadStoredJson(GROUP_SORT_KEY);
  return TRAFFIC_GROUP_SORT_MODES.find((mode) => mode === value) ?? "traffic";
}

export function saveConnectionGroupSort(mode: TrafficGroupSortMode): void {
  saveStoredJson(GROUP_SORT_KEY, mode);
}

export function loadConnectionGroupDirection(): SortDirection {
  return loadStoredJson(GROUP_DIRECTION_KEY) === "asc" ? "asc" : "desc";
}

export function saveConnectionGroupDirection(direction: SortDirection): void {
  saveStoredJson(GROUP_DIRECTION_KEY, direction);
}

export interface PendingConnectionView {
  filters?: Partial<ConnectionFilters>;
  view?: ConnectionViewMode;
}

let pendingConnectionView: PendingConnectionView | null = null;

export function setPendingConnectionView(view: PendingConnectionView): void {
  pendingConnectionView = view;
}

export function takePendingConnectionView(): PendingConnectionView | null {
  const pending = pendingConnectionView;
  pendingConnectionView = null;
  return pending;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isState(value: unknown): value is ConnectionStateFilter {
  return CONNECTION_STATES.some((state) => state === value);
}

function isWindow(value: unknown): value is ConnectionTimeWindow {
  return CONNECTION_TIME_WINDOWS.some((window) => window === value);
}

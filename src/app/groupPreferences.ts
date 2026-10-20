import {
  GROUP_ITEM_SORT_MODES,
  GROUP_SORT_MODES,
  GROUP_VIEW_MODES,
  type GroupItemSortMode,
  type GroupSortMode,
  type GroupViewMode,
} from "../lib/groups";
import { loadStoredJson, saveStoredJson } from "../lib/storage";

const VIEW_MODE_KEY = "group-view-mode";
const SORT_MODE_KEY = "group-sort-mode";
const ITEM_SORT_MODE_KEY = "group-item-sort-mode";

export function loadGroupViewMode(): GroupViewMode {
  const value = loadStoredJson(VIEW_MODE_KEY);
  return GROUP_VIEW_MODES.find((mode) => mode === value) ?? "cards";
}

export function saveGroupViewMode(mode: GroupViewMode): void {
  saveStoredJson(VIEW_MODE_KEY, mode);
}

export function loadGroupSortMode(): GroupSortMode {
  const value = loadStoredJson(SORT_MODE_KEY);
  return GROUP_SORT_MODES.find((mode) => mode === value) ?? "default";
}

export function saveGroupSortMode(mode: GroupSortMode): void {
  saveStoredJson(SORT_MODE_KEY, mode);
}

export function loadGroupItemSortMode(): GroupItemSortMode {
  const value = loadStoredJson(ITEM_SORT_MODE_KEY);
  return GROUP_ITEM_SORT_MODES.find((mode) => mode === value) ?? "default";
}

export function saveGroupItemSortMode(mode: GroupItemSortMode): void {
  saveStoredJson(ITEM_SORT_MODE_KEY, mode);
}

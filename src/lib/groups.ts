import type { Group, GroupItem } from "../gen/daemon/started_service_pb";

export type GroupViewMode = "cards" | "list";
export type GroupSortMode = "default" | "name" | "latency" | "type";
export type GroupItemSortMode = "default" | "name" | "latency" | "type";

export const GROUP_VIEW_MODES: GroupViewMode[] = ["cards", "list"];
export const GROUP_SORT_MODES: GroupSortMode[] = ["default", "name", "latency", "type"];
export const GROUP_ITEM_SORT_MODES: GroupItemSortMode[] = ["default", "name", "latency", "type"];

export function fastestDelay(items: GroupItem[]): number {
  let fastest = 0;
  for (const item of items) {
    if (item.urlTestDelay > 0 && (fastest === 0 || item.urlTestDelay < fastest)) {
      fastest = item.urlTestDelay;
    }
  }
  return fastest;
}

export function availableItemCount(items: GroupItem[]): number {
  let count = 0;
  for (const item of items) {
    if (item.urlTestDelay > 0) {
      count += 1;
    }
  }
  return count;
}

export function compareGroupItems(
  left: GroupItem,
  right: GroupItem,
  mode: GroupItemSortMode,
): number {
  switch (mode) {
    case "name":
      return left.tag.localeCompare(right.tag);
    case "type":
      return left.type.localeCompare(right.type) || left.tag.localeCompare(right.tag);
    case "latency": {
      const leftDelay = left.urlTestDelay > 0 ? left.urlTestDelay : Number.MAX_SAFE_INTEGER;
      const rightDelay = right.urlTestDelay > 0 ? right.urlTestDelay : Number.MAX_SAFE_INTEGER;
      return leftDelay - rightDelay || left.tag.localeCompare(right.tag);
    }
    default:
      return 0;
  }
}

export function sortGroupItems(items: GroupItem[], mode: GroupItemSortMode): GroupItem[] {
  if (mode === "default") {
    return items;
  }
  return [...items].sort((left, right) => compareGroupItems(left, right, mode));
}

export function compareGroups(left: Group, right: Group, mode: GroupSortMode): number {
  switch (mode) {
    case "name":
      return left.tag.localeCompare(right.tag);
    case "type":
      return left.type.localeCompare(right.type) || left.tag.localeCompare(right.tag);
    case "latency": {
      const leftDelay = fastestDelay(left.items) || Number.MAX_SAFE_INTEGER;
      const rightDelay = fastestDelay(right.items) || Number.MAX_SAFE_INTEGER;
      return leftDelay - rightDelay || left.tag.localeCompare(right.tag);
    }
    default:
      return 0;
  }
}

export function sortGroups(groups: Group[], mode: GroupSortMode): Group[] {
  if (mode === "default") {
    return groups;
  }
  return [...groups].sort((left, right) => compareGroups(left, right, mode));
}

export interface GroupSearchResult {
  group: Group;
  items: GroupItem[];
}

export function filterGroups(groups: Group[], search: string): GroupSearchResult[] {
  const query = search.trim().toLowerCase();
  if (query === "") {
    return groups.map((group) => ({ group, items: group.items }));
  }
  const result: GroupSearchResult[] = [];
  for (const group of groups) {
    const groupMatches =
      group.tag.toLowerCase().includes(query) || group.type.toLowerCase().includes(query);
    const items = groupMatches
      ? group.items
      : group.items.filter(
          (item) =>
            item.tag.toLowerCase().includes(query) || item.type.toLowerCase().includes(query),
        );
    if (groupMatches || items.length > 0) {
      result.push({ group, items });
    }
  }
  return result;
}

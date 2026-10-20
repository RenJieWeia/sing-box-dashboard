import { useMemo, useState } from "react";

import { proxyDisplayType, urlTestDelayTone } from "../api/format";
import { useStream } from "../api/stream";
import {
  loadGroupItemSortMode,
  loadGroupSortMode,
  loadGroupViewMode,
  saveGroupItemSortMode,
  saveGroupSortMode,
  saveGroupViewMode,
} from "../app/groupPreferences";
import { useApi } from "../app/context";
import { showError } from "../app/errorStore";
import { usePendingValue } from "../app/hooks";
import { useI18n, type MessageKey } from "../app/i18n";
import { Icon } from "../components/Icon";
import { PageHeader } from "../components/PageHeader";
import { StatGrid } from "../components/StatGrid";
import { StreamStates } from "../components/StreamBanner";
import {
  Badge,
  Card,
  IconButton,
  MenuItem,
  MenuLabel,
  OthersMenu,
  SearchInput,
  Select,
  Spinner,
  useContextMenu,
} from "../components/ui";
import type { Group, GroupItem } from "../gen/daemon/started_service_pb";
import { csvTimestamp, downloadCsv, type CsvCell } from "../lib/csv";
import {
  compareGroups,
  fastestDelay,
  filterGroups,
  sortGroupItems,
  type GroupItemSortMode,
  type GroupSortMode,
} from "../lib/groups";
import { cx } from "../lib/cx";
import styles from "./GroupsView.module.css";

const PREVIEW_ITEMS = 12;

const GROUP_SORT_OPTIONS: { value: GroupSortMode; label: MessageKey }[] = [
  { value: "default", label: "Default" },
  { value: "name", label: "By name" },
  { value: "latency", label: "By latency" },
  { value: "type", label: "By type" },
];

const ITEM_SORT_OPTIONS: { value: GroupItemSortMode; label: MessageKey }[] = [
  { value: "default", label: "Default" },
  { value: "name", label: "By name" },
  { value: "latency", label: "By latency" },
  { value: "type", label: "By type" },
];

export function GroupsView() {
  const api = useApi();
  const { t } = useI18n();
  const groups = useStream(api.groups);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState(loadGroupViewMode);
  const [groupSort, setGroupSort] = useState<GroupSortMode>(loadGroupSortMode);
  const [itemSort, setItemSort] = useState<GroupItemSortMode>(loadGroupItemSortMode);
  const [testingAll, setTestingAll] = useState(false);

  const visibleGroups = useMemo(() => {
    const entries = filterGroups(groups.data.groups, search);
    entries.sort((left, right) => compareGroups(left.group, right.group, groupSort));
    return entries;
  }, [groups.data.groups, search, groupSort]);

  const stats = useMemo(() => {
    let nodes = 0;
    let available = 0;
    let fastest = 0;
    for (const group of groups.data.groups) {
      for (const item of group.items) {
        nodes += 1;
        if (item.urlTestDelay > 0) {
          available += 1;
          if (fastest === 0 || item.urlTestDelay < fastest) {
            fastest = item.urlTestDelay;
          }
        }
      }
    }
    return { nodes, available, fastest };
  }, [groups.data.groups]);

  const persistView = (mode: "cards" | "list") => {
    setViewMode(() => mode);
    saveGroupViewMode(mode);
  };

  const persistSort = (mode: GroupSortMode) => {
    setGroupSort(() => mode);
    saveGroupSortMode(mode);
  };

  const persistItemSort = (mode: GroupItemSortMode) => {
    setItemSort(() => mode);
    saveGroupItemSortMode(mode);
  };

  const exportCsv = () => {
    const rows: CsvCell[][] = [
      [
        "group",
        "group_type",
        "selectable",
        "selected",
        "item",
        "item_type",
        "delay_ms",
        "url_test_time",
      ],
      ...visibleGroups.flatMap((entry) =>
        sortGroupItems(entry.items, itemSort).map((item) => [
          entry.group.tag,
          entry.group.type,
          entry.group.selectable ? "true" : "false",
          entry.group.selected,
          item.tag,
          item.type,
          item.urlTestDelay > 0 ? item.urlTestDelay : "",
          item.urlTestTime,
        ]),
      ),
    ];
    downloadCsv(`groups-${csvTimestamp()}.csv`, rows);
  };

  const setAllExpanded = (expanded: boolean) => {
    for (const entry of visibleGroups) {
      if (entry.group.isExpand === expanded) {
        continue;
      }
      void api.setGroupExpand(entry.group.tag, expanded).catch(showError);
    }
  };

  const testAll = () => {
    if (testingAll || visibleGroups.length === 0) {
      return;
    }
    setTestingAll(true);
    const calls = visibleGroups.map((entry) => api.urlTest(entry.group.tag));
    Promise.allSettled(calls)
      .then((results) => {
        const failure = results.find(
          (result): result is PromiseRejectedResult => result.status === "rejected",
        );
        if (failure) {
          showError(failure.reason);
        }
      })
      .finally(() => setTestingAll(false));
  };

  return (
    <div className="page">
      <PageHeader
        title={t("Groups")}
        actions={
          <>
            <IconButton
              title={t("URL test all")}
              disabled={testingAll}
              onClick={testAll}
            >
              {testingAll ? <Spinner /> : <Icon name="speed" />}
            </IconButton>
            <OthersMenu>
              <MenuLabel>{t("Sort groups")}</MenuLabel>
              {GROUP_SORT_OPTIONS.map((option) => (
                <MenuItem
                  key={option.value}
                  checked={groupSort === option.value}
                  onSelect={() => persistSort(option.value)}
                >
                  {t(option.label)}
                </MenuItem>
              ))}
              <div className="menu-divider" />
              <MenuLabel>{t("Item order")}</MenuLabel>
              {ITEM_SORT_OPTIONS.map((option) => (
                <MenuItem
                  key={option.value}
                  checked={itemSort === option.value}
                  onSelect={() => persistItemSort(option.value)}
                >
                  {t(option.label)}
                </MenuItem>
              ))}
              <div className="menu-divider" />
              <MenuItem icon="description" onSelect={exportCsv}>
                {t("Export CSV")}
              </MenuItem>
              <div className="menu-divider" />
              <MenuItem icon="expand_more" onSelect={() => setAllExpanded(true)}>
                {t("Expand all")}
              </MenuItem>
              <MenuItem icon="expand_less" onSelect={() => setAllExpanded(false)}>
                {t("Collapse all")}
              </MenuItem>
              <MenuItem icon="speed" onSelect={testAll}>
                {t("URL test all")}
              </MenuItem>
            </OthersMenu>
          </>
        }
      />

      <div className={styles.toolbar}>
        <div className={styles.toolbarSearch}>
          <SearchInput value={search} onChange={setSearch} />
        </div>
        <div className={styles.segmentedWrap}>
          <div className="segmented">
            <button
              type="button"
              className={viewMode === "cards" ? "active" : ""}
              onClick={() => persistView("cards")}
            >
              {t("Cards")}
            </button>
            <button
              type="button"
              className={viewMode === "list" ? "active" : ""}
              onClick={() => persistView("list")}
            >
              {t("List")}
            </button>
          </div>
        </div>
        <span className={styles.controlLabel}>{t("Sort groups")}</span>
        <Select
          inline
          options={GROUP_SORT_OPTIONS.map((option) => ({
            value: option.value,
            label: t(option.label),
          }))}
          value={groupSort}
          onChange={persistSort}
        />
      </div>

      <StatGrid
        items={[
          {
            label: t("Groups"),
            icon: "folder",
            tone: "accent",
            value: visibleGroups.length,
            hint:
              search.trim() === ""
                ? undefined
                : t("Showing {shown} of {count}", {
                    shown: visibleGroups.length,
                    count: groups.data.groups.length,
                  }),
          },
          { label: t("Nodes"), value: stats.nodes, icon: "hub", tone: "info" },
          {
            label: t("Fastest"),
            icon: "speed",
            value: stats.fastest > 0 ? `${stats.fastest}ms` : "-",
            tone: stats.fastest > 0 ? urlTestDelayTone(stats.fastest) : undefined,
          },
          {
            label: t("Available"),
            icon: "network_check",
            value: `${stats.available} / ${stats.nodes}`,
            tone: stats.available > 0 && stats.available === stats.nodes ? "good" : undefined,
          },
        ]}
      />

      <StreamStates
        snapshot={groups}
        loaded={groups.data.loaded}
        empty={visibleGroups.length === 0}
        emptyIcon="folder"
        emptyMessage={t(search.trim() !== "" ? "No matching groups" : "Empty groups")}
      />

      {viewMode === "cards"
        ? visibleGroups.map((entry) => (
            <GroupCard
              key={entry.group.tag}
              group={entry.group}
              items={entry.items}
              itemSort={itemSort}
              searchActive={search.trim() !== ""}
            />
          ))
        : visibleGroups.map((entry) => (
            <GroupListRow
              key={entry.group.tag}
              group={entry.group}
              items={entry.items}
              itemSort={itemSort}
            />
          ))}
    </div>
  );
}

function useGroupController(group: Group) {
  const api = useApi();
  const [testing, setTesting] = useState(false);
  const [expanded, setExpandOverride] = usePendingValue(group.isExpand);
  const [selected, setPendingSelection] = usePendingValue(group.selected);

  const toggleExpand = () => {
    const next = !expanded;
    setExpandOverride(next);
    api.setGroupExpand(group.tag, next).catch(() => setExpandOverride(null));
  };

  const runURLTest = () => {
    setTesting(true);
    api
      .urlTest(group.tag)
      .catch(showError)
      .finally(() => setTesting(false));
  };

  const selectItem = (item: GroupItem) => {
    if (!group.selectable || item.tag === selected) {
      return;
    }
    setPendingSelection(item.tag);
    api.selectOutbound(group.tag, item.tag).catch((error: unknown) => {
      setPendingSelection(null);
      showError(error);
    });
  };

  return {
    expanded,
    selected,
    testing,
    toggleExpand,
    runURLTest,
    selectItem,
  };
}

function GroupCard(props: {
  group: Group;
  items: GroupItem[];
  itemSort: GroupItemSortMode;
  searchActive: boolean;
}) {
  const { t } = useI18n();
  const controller = useGroupController(props.group);
  const group = props.group;
  const items = useMemo(
    () => sortGroupItems(props.items, props.itemSort),
    [props.items, props.itemSort],
  );
  const selectedItem = items.find((item) => item.tag === controller.selected);
  const fastest = fastestDelay(group.items);
  const selectedTone =
    selectedItem && selectedItem.urlTestDelay > 0
      ? urlTestDelayTone(selectedItem.urlTestDelay)
      : undefined;
  const maxDelay = slowestDelay(group.items);
  const cardTone = selectedTone ?? (fastest > 0 ? urlTestDelayTone(fastest) : undefined);
  const preview = items.slice(0, PREVIEW_ITEMS);
  if (selectedItem && !preview.includes(selectedItem)) {
    preview.unshift(selectedItem);
  }

  return (
    <div
      className={cx(
        styles.groupCard,
        controller.expanded && styles.expanded,
        cardTone !== undefined && styles[cardTone],
      )}
    >
      <Card
        icon={group.type === "selector" || group.type === "urltest" ? "route" : "hub"}
        title={
          <>
            {group.tag}
            <span className={styles.groupType}>{proxyDisplayType(group.type)}</span>
          </>
        }
        actions={
          <>
            {selectedItem && selectedItem.urlTestDelay > 0 && (
              <span className={styles.headerDelay}>
                <Badge tone={selectedTone}>{selectedItem.urlTestDelay}ms</Badge>
              </span>
            )}
            <Badge>{items.length}</Badge>
            <IconButton title={t("URL test")} onClick={controller.runURLTest} disabled={controller.testing}>
              {controller.testing ? <Spinner /> : <Icon name="speed" />}
            </IconButton>
            <IconButton
              title={controller.expanded ? t("Collapse") : t("Expand")}
              onClick={controller.toggleExpand}
            >
              <Icon name={controller.expanded ? "expand_less" : "expand_more"} />
            </IconButton>
          </>
        }
      >
        <div className={styles.groupMeta}>
          <span className={styles.metaItem}>
            <span className={styles.metaLabel}>{t("Selected")}</span>
            <span
              className={cx(
                styles.metaValue,
                selectedTone !== undefined && styles[selectedTone],
              )}
              title={controller.selected}
            >
              {controller.selected !== "" ? controller.selected : "-"}
              {selectedItem && selectedItem.urlTestDelay > 0
                ? ` · ${selectedItem.urlTestDelay}ms`
                : ""}
            </span>
          </span>
          <span className={styles.metaItem}>
            <span className={styles.metaLabel}>{t("Fastest")}</span>
            <span className={styles.metaValue}>{fastest > 0 ? `${fastest}ms` : "-"}</span>
          </span>
          {props.searchActive && items.length !== group.items.length && (
            <span className={styles.metaItem}>
              <span className={styles.metaLabel}>{t("Nodes")}</span>
              <span className={styles.metaValue}>
                {items.length} / {group.items.length}
              </span>
            </span>
          )}
        </div>
        {controller.expanded ? (
          <div className={styles.groupItems}>
            {items.map((item) => (
              <GroupItemCard
                key={item.tag}
                item={item}
                selected={item.tag === controller.selected}
                maxDelay={maxDelay}
                onSelect={() => controller.selectItem(item)}
              />
            ))}
          </div>
        ) : (
          <div className={styles.groupPreview}>
            {preview.map((item) => {
              const tone = item.urlTestDelay > 0 ? urlTestDelayTone(item.urlTestDelay) : "";
              return (
                <button
                  key={item.tag}
                  type="button"
                  className={cx(
                    styles.previewItem,
                    item.tag === controller.selected && styles.selected,
                    tone !== "" && styles[tone],
                  )}
                  title={`${item.tag}${item.urlTestDelay > 0 ? ` · ${item.urlTestDelay}ms` : ""}`}
                  onClick={() => controller.selectItem(item)}
                >
                  <span className={styles.previewTag}>{item.tag}</span>
                  {item.urlTestDelay > 0 && (
                    <span className={styles.previewDelay}>{item.urlTestDelay}ms</span>
                  )}
                </button>
              );
            })}
            {items.length > preview.length && (
              <span className={styles.previewMore}>+{items.length - preview.length}</span>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

function slowestDelay(items: GroupItem[]): number {
  let slowest = 0;
  for (const item of items) {
    if (item.urlTestDelay > slowest) {
      slowest = item.urlTestDelay;
    }
  }
  return slowest;
}

function GroupItemCard(props: {
  item: GroupItem;
  selected: boolean;
  maxDelay: number;
  onSelect: () => void;
}) {
  const api = useApi();
  const { t } = useI18n();
  const item = props.item;
  const tone = item.urlTestDelay > 0 ? urlTestDelayTone(item.urlTestDelay) : "";
  const width =
    props.maxDelay > 0 && item.urlTestDelay > 0
      ? Math.max((item.urlTestDelay / props.maxDelay) * 100, 6)
      : 0;
  const menu = useContextMenu(
    <MenuItem icon="speed" onSelect={() => api.urlTest(item.tag).catch(showError)}>
      {t("URL test")}
    </MenuItem>,
  );

  return (
    <>
      <button
        type="button"
        className={cx(styles.groupItem, props.selected && styles.selected)}
        onClick={props.onSelect}
        title={`${item.tag}${item.urlTestDelay > 0 ? ` · ${item.urlTestDelay}ms` : ""}`}
        {...menu.triggerProps}
      >
        <span className={styles.itemTag}>{item.tag}</span>
        <span className={styles.itemMeta}>
          <span>{proxyDisplayType(item.type)}</span>
          {item.urlTestDelay > 0 && (
            <span className={cx(styles.delayText, tone !== "" && styles[tone])}>
              {item.urlTestDelay}ms
            </span>
          )}
        </span>
        <span className={styles.delayTrack}>
          <span
            className={cx(styles.delayFill, tone !== "" && styles[tone])}
            style={{ width: `${width}%` }}
          />
        </span>
      </button>
      {menu.element}
    </>
  );
}

function GroupListRow(props: {
  group: Group;
  items: GroupItem[];
  itemSort: GroupItemSortMode;
}) {
  const { t } = useI18n();
  const controller = useGroupController(props.group);
  const group = props.group;
  const items = useMemo(
    () => sortGroupItems(props.items, props.itemSort),
    [props.items, props.itemSort],
  );
  const selectedItem = items.find((item) => item.tag === controller.selected);
  const selectedTone =
    selectedItem && selectedItem.urlTestDelay > 0
      ? urlTestDelayTone(selectedItem.urlTestDelay)
      : undefined;
  const fastest = fastestDelay(items);
  const rowTone = selectedTone ?? (fastest > 0 ? urlTestDelayTone(fastest) : undefined);

  return (
    <div
      className={cx(
        styles.groupRow,
        controller.expanded && styles.expanded,
        rowTone !== undefined && styles[rowTone],
      )}
    >
      <div className={styles.rowHeader}>
        <button
          type="button"
          className={styles.rowToggle}
          aria-expanded={controller.expanded}
          title={group.tag}
          onClick={controller.toggleExpand}
        >
          <Icon name={controller.expanded ? "expand_less" : "expand_more"} />
          <span className={cx(styles.rowDot, rowTone !== undefined && styles[rowTone])} />
          <span className={styles.rowTag}>{group.tag}</span>
          <span className={styles.rowType}>{proxyDisplayType(group.type)}</span>
          {controller.selected !== "" && (
            <span className={styles.rowSelected}>
              {controller.selected}
              {selectedItem && selectedItem.urlTestDelay > 0 && (
                <span className={cx(styles.rowSelectedDelay, selectedTone && styles[selectedTone])}>
                  {selectedItem.urlTestDelay}ms
                </span>
              )}
            </span>
          )}
          <Badge>{items.length}</Badge>
        </button>
        <IconButton title={t("URL test")} onClick={controller.runURLTest} disabled={controller.testing}>
          {controller.testing ? <Spinner /> : <Icon name="speed" />}
        </IconButton>
      </div>
      {controller.expanded && (
        <div className={styles.rowItems}>
          {items.map((item) => (
            <GroupItemRow
              key={item.tag}
              item={item}
              selected={item.tag === controller.selected}
              onSelect={() => controller.selectItem(item)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function GroupItemRow(props: { item: GroupItem; selected: boolean; onSelect: () => void }) {
  const api = useApi();
  const { t } = useI18n();
  const item = props.item;
  const tone = item.urlTestDelay > 0 ? urlTestDelayTone(item.urlTestDelay) : "";
  const menu = useContextMenu(
    <MenuItem icon="speed" onSelect={() => api.urlTest(item.tag).catch(showError)}>
      {t("URL test")}
    </MenuItem>,
  );

  return (
    <>
      <button
        type="button"
        className={cx(styles.rowItem, props.selected && styles.rowItemSelected)}
        title={item.tag}
        onClick={props.onSelect}
        {...menu.triggerProps}
      >
        <span className={styles.itemTag}>{item.tag}</span>
        <span className={styles.rowItemType}>{proxyDisplayType(item.type)}</span>
        {item.urlTestDelay > 0 && (
          <span className={cx(styles.delayText, tone !== "" && styles[tone])}>
            {item.urlTestDelay}ms
          </span>
        )}
        {props.selected && <Icon name="check" size={14} />}
      </button>
      {menu.element}
    </>
  );
}

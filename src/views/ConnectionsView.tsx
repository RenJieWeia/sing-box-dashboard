import { Code } from "@connectrpc/connect";
import { memo, useEffect, useMemo, useState } from "react";

import type { ConnectionRow } from "../api/daemon";
import { formatBytes, formatClockTime, formatDateTime, formatDurationMs } from "../api/format";
import { useStream } from "../api/stream";
import {
  loadConnectionFilters,
  loadConnectionGroupDimension,
  loadConnectionGroupDirection,
  loadConnectionGroupSort,
  loadConnectionSortDirection,
  loadConnectionSortMode,
  loadConnectionViewMode,
  saveConnectionFilters,
  saveConnectionGroupDimension,
  saveConnectionGroupDirection,
  saveConnectionGroupSort,
  saveConnectionSortDirection,
  saveConnectionSortMode,
  saveConnectionViewMode,
  takePendingConnectionView,
  type ConnectionViewMode,
} from "../app/connectionPreferences";
import { useApi, useIsMobile, useNow } from "../app/context";
import { showError } from "../app/errorStore";
import { useI18n, type MessageKey } from "../app/i18n";
import { Icon } from "../components/Icon";
import { PageHeader } from "../components/PageHeader";
import { StatGrid } from "../components/StatGrid";
import { StreamStates } from "../components/StreamBanner";
import {
  Badge,
  Button,
  DataLine,
  DetailSection,
  DetailShell,
  Field,
  IconButton,
  MenuItem,
  OthersMenu,
  SearchInput,
  Select,
} from "../components/ui";
import { csvTimestamp, downloadCsv, type CsvCell } from "../lib/csv";
import {
  collectFacetValues,
  connectionProcess,
  DEFAULT_CONNECTION_FILTERS,
  filterConnections,
  groupTraffic,
  sortConnectionRows,
  sortTrafficGroups,
  summarizeTraffic,
  trafficShare,
  type ConnectionFilters,
  type ConnectionSortMode,
  type ConnectionStateFilter,
  type ConnectionTimeWindow,
  type SortDirection,
  type TrafficDimension,
  type TrafficGroup,
  type TrafficGroupSortMode,
} from "../lib/traffic";
import { cx } from "../lib/cx";
import styles from "./ConnectionsView.module.css";

const PAGE_SIZE = 200;

const STATE_OPTIONS: { value: ConnectionStateFilter; label: MessageKey }[] = [
  { value: "active", label: "Active" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
];

const EMPTY_MESSAGES: Record<ConnectionStateFilter, MessageKey> = {
  active: "No active connections",
  closed: "No closed connections",
  all: "No connections",
};

const SORT_OPTIONS: { value: ConnectionSortMode; label: MessageKey }[] = [
  { value: "date", label: "By date" },
  { value: "traffic", label: "By traffic" },
  { value: "trafficTotal", label: "By traffic total" },
  { value: "upload", label: "By upload" },
  { value: "download", label: "By download" },
  { value: "duration", label: "By duration" },
  { value: "destination", label: "By destination" },
];

const GROUP_OPTIONS: { value: TrafficDimension; label: MessageKey }[] = [
  { value: "outbound", label: "Outbound" },
  { value: "inbound", label: "Inbound" },
  { value: "rule", label: "Rule" },
  { value: "domain", label: "Domain" },
  { value: "process", label: "Process" },
  { value: "protocol", label: "Protocol" },
  { value: "network", label: "Network" },
  { value: "source", label: "Source IP" },
];

const GROUP_SORT_OPTIONS: { value: TrafficGroupSortMode; label: MessageKey }[] = [
  { value: "traffic", label: "By traffic total" },
  { value: "rate", label: "By traffic" },
  { value: "count", label: "By count" },
  { value: "name", label: "By name" },
];

const WINDOW_OPTIONS: { value: ConnectionTimeWindow; label: MessageKey }[] = [
  { value: "all", label: "Any time" },
  { value: "1m", label: "Last minute" },
  { value: "5m", label: "Last 5 minutes" },
  { value: "1h", label: "Last hour" },
  { value: "24h", label: "Last 24 hours" },
];

export function ConnectionsView() {
  const api = useApi();
  const { t } = useI18n();
  const connections = useStream(api.connections);
  const isMobile = useIsMobile();
  const now = useNow(1000);
  const [viewMode, setViewMode] = useState<ConnectionViewMode>(loadConnectionViewMode);
  const [filters, setFilters] = useState<ConnectionFilters>(loadConnectionFilters);
  const [sortMode, setSortMode] = useState<ConnectionSortMode>(loadConnectionSortMode);
  const [direction, setDirection] = useState<SortDirection>(loadConnectionSortDirection);
  const [groupDirection, setGroupDirection] = useState<SortDirection>(loadConnectionGroupDirection);
  const [groupDimension, setGroupDimension] = useState<TrafficDimension>(loadConnectionGroupDimension);
  const [groupSort, setGroupSort] = useState<TrafficGroupSortMode>(loadConnectionGroupSort);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => {
    const pending = takePendingConnectionView();
    if (pending === null) {
      return;
    }
    if (pending.view !== undefined) {
      setViewMode(pending.view);
    }
    if (pending.filters !== undefined) {
      setFilters((current) => ({ ...current, ...pending.filters }));
    }
  }, []);

  useEffect(() => saveConnectionFilters(filters), [filters]);
  useEffect(() => saveConnectionViewMode(viewMode), [viewMode]);
  useEffect(() => saveConnectionSortMode(sortMode), [sortMode]);
  useEffect(() => saveConnectionSortDirection(direction), [direction]);
  useEffect(() => saveConnectionGroupDimension(groupDimension), [groupDimension]);
  useEffect(() => saveConnectionGroupSort(groupSort), [groupSort]);
  useEffect(() => saveConnectionGroupDirection(groupDirection), [groupDirection]);
  useEffect(() => {
    setVisibleLimit(PAGE_SIZE);
  }, [filters, sortMode, direction, search, viewMode, groupDimension, groupSort, groupDirection]);

  const allRows = useMemo(() => [...connections.data.rows.values()], [connections.data.rows]);

  const matchingRows = useMemo(
    () => filterConnections(allRows, filters, search, now),
    [allRows, filters, search, now],
  );

  const sortedRows = useMemo(
    () =>
      viewMode === "analysis"
        ? []
        : sortConnectionRows(matchingRows, sortMode, direction, now),
    [matchingRows, sortMode, direction, now, viewMode],
  );

  const summary = useMemo(() => summarizeTraffic(matchingRows), [matchingRows]);

  const groups = useMemo(
    () =>
      viewMode === "list"
        ? []
        : sortTrafficGroups(
            groupTraffic(matchingRows, groupDimension),
            groupSort,
            groupDirection,
          ),
    [matchingRows, groupDimension, groupSort, groupDirection, viewMode],
  );

  const activeFilterCount = useMemo(() => countActiveFilters(filters), [filters]);
  const hasQuery = search.trim() !== "" || activeFilterCount > 0;

  const maxTotal = useMemo(() => {
    let total = 0n;
    for (const row of sortedRows) {
      const value = row.uplinkTotal + row.downlinkTotal;
      if (value > total) {
        total = value;
      }
    }
    return total;
  }, [sortedRows]);

  const updateFilters = (patch: Partial<ConnectionFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
  };

  const resetFilters = () => setFilters(() => ({ ...DEFAULT_CONNECTION_FILTERS }));

  const changeSortMode = (mode: ConnectionSortMode) => {
    setSortMode(mode);
    if (mode === "destination") {
      setDirection("asc");
    } else if (mode === "date") {
      setDirection("desc");
    }
  };

  const changeGroupSort = (mode: TrafficGroupSortMode) => {
    setGroupSort(mode);
    setGroupDirection(mode === "name" ? "asc" : "desc");
  };

  const currentDirection = viewMode === "analysis" ? groupDirection : direction;
  const toggleDirection = () => {
    const next = currentDirection === "asc" ? "desc" : "asc";
    if (viewMode === "analysis") {
      setGroupDirection(next);
    } else {
      setDirection(next);
    }
  };

  const exportCsv = () => {
    if (viewMode === "analysis") {
      const total = summary.uplinkTotal + summary.downlinkTotal;
      const rows: CsvCell[][] = [
        [
          "group",
          "connections",
          "active",
          "uplink_total",
          "downlink_total",
          "uplink_rate",
          "downlink_rate",
          "share_percent",
        ],
        ...groups.map((group) => {
          const groupTotal = group.uplinkTotal + group.downlinkTotal;
          return [
            group.key,
            group.count,
            group.activeCount,
            group.uplinkTotal,
            group.downlinkTotal,
            group.uplinkRate,
            group.downlinkRate,
            total > 0n ? Math.round(Number(groupTotal) / Number(total) * 10000) / 100 : 0,
          ];
        }),
      ];
      downloadCsv(`traffic-analysis-${csvTimestamp()}.csv`, rows);
      return;
    }
    const rows: CsvCell[][] = [
      [
        "id",
        "network",
        "ip_version",
        "source",
        "destination",
        "domain",
        "inbound",
        "inbound_type",
        "outbound",
        "outbound_type",
        "rule",
        "protocol",
        "process",
        "chain",
        "created_at",
        "closed_at",
        "duration_ms",
        "uplink_total",
        "downlink_total",
        "uplink_rate",
        "downlink_rate",
        "active",
      ],
      ...sortedRows.map((row) => {
        const connection = row.connection;
        const createdAt = Number(connection.createdAt);
        const createdAtIso = createdAt > 0 ? new Date(createdAt).toISOString() : "";
        const closedAtIso = row.closedAt === null ? "" : new Date(row.closedAt).toISOString();
        return [
          connection.id,
          connection.network,
          connection.ipVersion,
          connection.source,
          connection.destination,
          connection.domain,
          connection.inbound,
          connection.inboundType,
          connection.outbound,
          connection.outboundType,
          connection.rule,
          connection.protocol,
          connectionProcess(connection),
          [...connection.chainList].reverse().join(" / "),
          createdAtIso,
          closedAtIso,
          Math.max((row.closedAt ?? now) - createdAt, 0),
          row.uplinkTotal,
          row.downlinkTotal,
          Math.round(row.uplinkRate),
          Math.round(row.downlinkRate),
          row.closedAt === null ? "true" : "false",
        ];
      }),
    ];
    downloadCsv(`connections-${csvTimestamp()}.csv`, rows);
  };

  const drillDown = (group: TrafficGroup) => {
    if (group.key === "") {
      return;
    }
    switch (groupDimension) {
      case "outbound":
        updateFilters({ outbound: group.key });
        break;
      case "inbound":
        updateFilters({ inbound: group.key });
        break;
      case "rule":
        updateFilters({ rule: group.key });
        break;
      case "network":
        updateFilters({ network: group.key.toLowerCase() });
        break;
      case "source":
        updateFilters({ sourceIp: group.key });
        break;
      default:
        setSearch(group.key);
        break;
    }
    setViewMode("list");
  };

  const detailRow = detailId !== null ? (connections.data.rows.get(detailId) ?? null) : null;
  const detailActive = detailRow?.closedAt === null;
  const detail = detailRow && (
    <DetailShell
      backLabel={t("Connections")}
      title={t("Connection")}
      accessory={
        <Badge tone={detailActive ? "good" : "danger"}>
          {detailActive ? t("Active") : t("Closed")}
        </Badge>
      }
      onClose={() => setDetailId(null)}
    >
      <ConnectionDetailBody row={detailRow} onClose={() => setDetailId(null)} />
    </DetailShell>
  );

  if (isMobile && detail) {
    return detail;
  }

  const visibleRows = sortedRows.slice(0, visibleLimit);

  return (
    <div className="page">
      <PageHeader
        title={t("Connections")}
        actions={
          <OthersMenu>
            <MenuItem
              icon="filter_list"
              onSelect={() => setFiltersOpen(!filtersOpen)}
            >
              {t("Filters")}
            </MenuItem>
            <MenuItem
              icon={currentDirection === "asc" ? "unfold_more" : "swap_vert"}
              onSelect={toggleDirection}
            >
              {currentDirection === "asc" ? t("Ascending") : t("Descending")}
            </MenuItem>
            <div className="menu-divider" />
            <MenuItem icon="description" onSelect={exportCsv}>
              {t("Export CSV")}
            </MenuItem>
            <div className="menu-divider" />
            <MenuItem
              danger
              icon="close"
              onSelect={() => {
                void api.closeAllConnections().catch(showError);
              }}
            >
              {t("Close All Connections")}
            </MenuItem>
          </OthersMenu>
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
              className={viewMode === "list" ? "active" : ""}
              onClick={() => setViewMode("list")}
            >
              {t("List")}
            </button>
            <button
              type="button"
              className={viewMode === "analysis" ? "active" : ""}
              onClick={() => setViewMode("analysis")}
            >
              {t("Analysis")}
            </button>
          </div>
        </div>
        <IconButton
          active={filtersOpen || activeFilterCount > 0}
          title={activeFilterCount > 0 ? `${t("Filters")} (${activeFilterCount})` : t("Filters")}
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen(!filtersOpen)}
        >
          <Icon name="filter_list" />
        </IconButton>
        {viewMode === "list" ? (
          <>
            <span className={styles.controlLabel}>{t("Sort By")}</span>
            <Select
              inline
              options={SORT_OPTIONS.map((option) => ({ value: option.value, label: t(option.label) }))}
              value={sortMode}
              onChange={changeSortMode}
            />
          </>
        ) : (
          <>
            <span className={styles.controlLabel}>{t("Group by")}</span>
            <Select
              inline
              options={GROUP_OPTIONS.map((option) => ({ value: option.value, label: t(option.label) }))}
              value={groupDimension}
              onChange={setGroupDimension}
            />
            <span className={styles.controlLabel}>{t("Sort By")}</span>
            <Select
              inline
              options={GROUP_SORT_OPTIONS.map((option) => ({
                value: option.value,
                label: t(option.label),
              }))}
              value={groupSort}
              onChange={changeGroupSort}
            />
          </>
        )}
        <IconButton
          title={currentDirection === "asc" ? t("Ascending") : t("Descending")}
          onClick={toggleDirection}
        >
          <span className={currentDirection === "asc" ? styles.directionAsc : styles.directionDesc}>
            <Icon name="unfold_more" />
          </span>
        </IconButton>
      </div>

      {filtersOpen && (
        <div className={styles.filters}>
          <Field label={t("State")}>
            <Select
              options={STATE_OPTIONS.map((option) => ({ value: option.value, label: t(option.label) }))}
              value={filters.state}
              onChange={(state) => updateFilters({ state })}
            />
          </Field>
          <Field label={t("Time range")}>
            <Select
              options={WINDOW_OPTIONS.map((option) => ({
                value: option.value,
                label: t(option.label),
              }))}
              value={filters.window}
              onChange={(window) => updateFilters({ window })}
            />
          </Field>
          <Field label={t("Network")}>
            <Select
              options={facetOptions(allRows, "network", filters.network, t("All"))}
              value={filters.network}
              onChange={(network) => updateFilters({ network })}
            />
          </Field>
          <Field label={t("Source IP")}>
            <Select
              options={facetOptions(allRows, "source", filters.sourceIp, t("All"))}
              value={filters.sourceIp}
              onChange={(sourceIp) => updateFilters({ sourceIp })}
            />
          </Field>
          <Field label={t("Inbound")}>
            <Select
              options={facetOptions(allRows, "inbound", filters.inbound, t("All"))}
              value={filters.inbound}
              onChange={(inbound) => updateFilters({ inbound })}
            />
          </Field>
          <Field label={t("Outbound")}>
            <Select
              options={facetOptions(allRows, "outbound", filters.outbound, t("All"))}
              value={filters.outbound}
              onChange={(outbound) => updateFilters({ outbound })}
            />
          </Field>
          <Field label={t("Rule")}>
            <Select
              options={facetOptions(allRows, "rule", filters.rule, t("All"))}
              value={filters.rule}
              onChange={(rule) => updateFilters({ rule })}
            />
          </Field>
          <Field label={t("Process")}>
            <Select
              options={facetOptions(allRows, "process", filters.process, t("All"))}
              value={filters.process}
              onChange={(process) => updateFilters({ process })}
            />
          </Field>
          <Field label={t("Protocol")}>
            <Select
              options={facetOptions(allRows, "protocol", filters.protocol, t("All"))}
              value={filters.protocol}
              onChange={(protocol) => updateFilters({ protocol })}
            />
          </Field>
          <div className={styles.filterActions}>
            <Button disabled={activeFilterCount === 0} onClick={resetFilters}>
              <Icon name="undo" size={13} />
              {t("Clear filters")}
            </Button>
          </div>
          <div className={styles.searchHint}>
            {t("Search supports key:value filters, e.g. outbound:proxy -udp")}
          </div>
        </div>
      )}

      {activeFilterCount > 0 && (
        <div className={styles.chips}>
          {activeFilterCount > 0 && filters.state !== "active" && (
            <FilterChip
              label={`${t("State")}: ${t(STATE_OPTIONS.find((option) => option.value === filters.state)?.label ?? "All")}`}
              onRemove={() => updateFilters({ state: "active" })}
            />
          )}
          {filters.window !== "all" && (
            <FilterChip
              label={`${t("Time range")}: ${t(WINDOW_OPTIONS.find((option) => option.value === filters.window)?.label ?? "Any time")}`}
              onRemove={() => updateFilters({ window: "all" })}
            />
          )}
          {filters.network !== "" && (
            <FilterChip
              label={`${t("Network")}: ${filters.network.toUpperCase()}`}
              onRemove={() => updateFilters({ network: "" })}
            />
          )}
          {filters.sourceIp !== "" && (
            <FilterChip
              label={`${t("Source IP")}: ${filters.sourceIp}`}
              onRemove={() => updateFilters({ sourceIp: "" })}
            />
          )}
          {filters.inbound !== "" && (
            <FilterChip
              label={`${t("Inbound")}: ${filters.inbound}`}
              onRemove={() => updateFilters({ inbound: "" })}
            />
          )}
          {filters.outbound !== "" && (
            <FilterChip
              label={`${t("Outbound")}: ${filters.outbound}`}
              onRemove={() => updateFilters({ outbound: "" })}
            />
          )}
          {filters.rule !== "" && (
            <FilterChip
              label={`${t("Rule")}: ${filters.rule}`}
              onRemove={() => updateFilters({ rule: "" })}
            />
          )}
          {filters.process !== "" && (
            <FilterChip
              label={`${t("Process")}: ${filters.process}`}
              onRemove={() => updateFilters({ process: "" })}
            />
          )}
          {filters.protocol !== "" && (
            <FilterChip
              label={`${t("Protocol")}: ${filters.protocol}`}
              onRemove={() => updateFilters({ protocol: "" })}
            />
          )}
          <button type="button" className={styles.clearChips} onClick={resetFilters}>
            {t("Clear filters")}
          </button>
        </div>
      )}

      <StatGrid
        items={[
          {
            label: t("Connections"),
            icon: "cable",
            tone: "accent",
            value: summary.count,
            hint: `${t("Active")} ${summary.activeCount} · ${t("Closed")} ${summary.closedCount}`,
          },
          {
            label: t("Current speed"),
            icon: "speed",
            tone: "down",
            value: `${formatBytes(summary.uplinkRate + summary.downlinkRate)}/s`,
            hint: `↑ ${formatBytes(summary.uplinkRate)}/s · ↓ ${formatBytes(summary.downlinkRate)}/s`,
          },
          {
            label: t("Total traffic"),
            icon: "swap_vert",
            tone: "info",
            value: formatBytes(summary.uplinkTotal + summary.downlinkTotal),
            hint: `↑ ${formatBytes(summary.uplinkTotal)} · ↓ ${formatBytes(summary.downlinkTotal)}`,
          },
          {
            label: t("Outbounds"),
            icon: "hub",
            tone: "up",
            value: new Set(matchingRows.map((row) => row.connection.outbound)).size,
            hint: t("Distinct outbounds"),
          },
        ]}
      />

      <StreamStates
        snapshot={connections}
        loaded={connections.data.loaded}
        empty={matchingRows.length === 0}
        emptyIcon="swap_vert"
        emptyMessage={t(hasQuery ? "No matching connections" : EMPTY_MESSAGES[filters.state])}
      />
      {connections.errorCode === Code.Unimplemented && connections.phase === "error" && (
        <div className="hint" style={{ marginBottom: 12 }}>
          {t("Connection tracking requires the Clash API to be configured in the running instance.")}
        </div>
      )}

      {viewMode === "analysis" ? (
        <TrafficBreakdown
          dimension={groupDimension}
          groups={groups}
          total={summary.uplinkTotal + summary.downlinkTotal}
          onSelect={drillDown}
        />
      ) : (
        <>
          {visibleRows.length > 0 && (
            <div className={styles.tableCard}>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.colStatus}>{t("Status")}</th>
                      <th className={styles.colNetwork}>{t("Network")}</th>
                      <th className={styles.colDestination}>{t("Destination")}</th>
                      <th className={styles.colInbound}>{t("Inbound")}</th>
                      <th className={styles.colOutbound}>{t("Outbound")}</th>
                      <th className={styles.colRule}>{t("Rule")}</th>
                      <th className={cx(styles.colSpeed, styles.numHead)}>{t("Speed")}</th>
                      <th className={cx(styles.colTotal, styles.numHead)}>{t("Total")}</th>
                      <th className={cx(styles.colDuration, styles.numHead)}>{t("Duration")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row) => (
                      <ConnectionRowView
                        key={row.connection.id}
                        row={row}
                        maxTotal={maxTotal}
                        now={now}
                        onOpen={setDetailId}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {matchingRows.length > visibleLimit && (
            <div className={styles.loadMore}>
              <Button onClick={() => setVisibleLimit(visibleLimit + PAGE_SIZE)}>
                {t("Show more")}
              </Button>
              <span className="hint">
                {t("Showing {shown} of {count}", {
                  shown: visibleLimit,
                  count: matchingRows.length,
                })}
              </span>
            </div>
          )}
        </>
      )}
      {detail}
    </div>
  );
}

function countActiveFilters(filters: ConnectionFilters): number {
  let count = 0;
  if (filters.state !== "active") count += 1;
  if (filters.network !== "") count += 1;
  if (filters.sourceIp !== "") count += 1;
  if (filters.inbound !== "") count += 1;
  if (filters.outbound !== "") count += 1;
  if (filters.rule !== "") count += 1;
  if (filters.process !== "") count += 1;
  if (filters.protocol !== "") count += 1;
  if (filters.window !== "all") count += 1;
  return count;
}

function facetOptions(
  rows: ConnectionRow[],
  dimension: TrafficDimension,
  selected: string,
  allLabel: string,
): { value: string; label: string }[] {
  const options = [{ value: "", label: allLabel }];
  const seen = new Set<string>();
  for (const facet of collectFacetValues(rows, dimension, 80)) {
    const value = dimension === "network" ? facet.value.toLowerCase() : facet.value;
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    const label = dimension === "network" ? value.toUpperCase() : value;
    options.push({ value, label: `${label} (${facet.count})` });
  }
  if (selected !== "" && !seen.has(selected)) {
    options.push({ value: selected, label: selected });
  }
  return options;
}

function FilterChip(props: { label: string; onRemove: () => void }) {
  return (
    <span className={styles.chip}>
      <span className={styles.chipLabel}>{props.label}</span>
      <button
        type="button"
        className={styles.chipRemove}
        aria-label={props.label}
        onClick={props.onRemove}
      >
        <Icon name="close" size={11} />
      </button>
    </span>
  );
}

function TrafficBreakdown(props: {
  dimension: TrafficDimension;
  groups: TrafficGroup[];
  total: bigint;
  onSelect: (group: TrafficGroup) => void;
}) {
  const { t } = useI18n();
  if (props.groups.length === 0) {
    return null;
  }
  return (
    <div className={styles.breakdown}>
      <div className={styles.breakdownHeader}>
        <span>{t(GROUP_OPTIONS.find((option) => option.value === props.dimension)?.label ?? "Outbound")}</span>
        <span>{t("Connections")}</span>
        <span>{t("Total traffic")}</span>
      </div>
      {props.groups.map((group) => {
        const total = group.uplinkTotal + group.downlinkTotal;
        const share = trafficShare(total, props.total);
        return (
          <button
            key={group.key}
            type="button"
            className={styles.breakdownRow}
            onClick={() => props.onSelect(group)}
          >
            <span className={styles.breakdownContent}>
              <span className={styles.breakdownKey} title={group.key}>
                {group.key === "" ? t("Unknown") : group.key}
              </span>
              <span className={styles.breakdownCount}>
                {group.count}
                {group.activeCount > 0 && (
                  <span className={styles.breakdownActive}> · {group.activeCount} {t("Active")}</span>
                )}
              </span>
              <span className={styles.breakdownTraffic}>
                <span className={styles.breakdownTotal}>{formatBytes(total)}</span>
                <span className={styles.breakdownShare}>{share.toFixed(1)}%</span>
              </span>
            </span>
            <span className={styles.breakdownRates}>
              {t("Traffic")}: ↑ {formatBytes(group.uplinkTotal)} · ↓ {formatBytes(group.downlinkTotal)}
            </span>
            <span className={styles.breakdownBar}>
              <span style={{ width: `${Math.max(share, 0.5)}%` }} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

const ConnectionRowView = memo(function ConnectionRowView(props: {
  row: ConnectionRow;
  maxTotal: bigint;
  now: number;
  onOpen: (id: string) => void;
}) {
  const { t } = useI18n();
  const row = props.row;
  const connection = row.connection;
  const active = row.closedAt === null;
  const chain = [...connection.chainList].reverse();
  const total = row.uplinkTotal + row.downlinkTotal;
  const share =
    props.maxTotal > 0n && total > 0n
      ? Math.max(Number(total) / Number(props.maxTotal) * 100, 1.5)
      : 0;
  const createdAt = Number(connection.createdAt);
  const duration = (row.closedAt ?? props.now) - createdAt;
  const title = connection.domain !== "" ? `${connection.domain} (${connection.destination})` : connection.destination;
  return (
    <tr
      className={cx(styles.row, active ? styles.activeRow : styles.closedRow)}
      onClick={() => props.onOpen(connection.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onOpen(connection.id);
        }
      }}
      tabIndex={0}
      title={title}
    >
      <td className={styles.statusCell}>
        <Badge tone={active ? "good" : "danger"}>{active ? t("Active") : t("Closed")}</Badge>
      </td>
      <td>
        <Badge>{connection.network.toUpperCase()}</Badge>
      </td>
      <td>
        <span className={styles.destinationStack}>
          <span className={styles.destination}>{connection.domain || connection.destination}</span>
          {connection.domain !== "" && (
            <span className={styles.destinationAddress}>{connection.destination}</span>
          )}
        </span>
      </td>
      <td className={styles.monoCell} title={`${connection.inboundType}/${connection.inbound}`}>
        {connection.inboundType !== "" ? `${connection.inboundType}/${connection.inbound}` : connection.inbound}
      </td>
      <td className={styles.monoCell} title={chain.join(" → ") || connection.outbound}>
        {chain.length > 0 ? chain.join(" → ") : connection.outbound}
      </td>
      <td className={styles.ruleCell} title={connection.rule}>
        {connection.rule !== "" ? (
          <span className={styles.ruleContent}>
            <Icon name="route" size={11} />
            <span className={styles.ruleText}>{connection.rule}</span>
          </span>
        ) : (
          <span className={styles.muted}>—</span>
        )}
      </td>
      <td className={cx(styles.numCell, styles.metricCell)}>
        {active ? (
          <>
            <span className={styles.uplink}>↑ {formatBytes(row.uplinkRate)}/s</span>
            <span className={styles.downlink}>↓ {formatBytes(row.downlinkRate)}/s</span>
          </>
        ) : (
          <span className={styles.muted}>—</span>
        )}
      </td>
      <td className={cx(styles.numCell, styles.metricCell)}>
        <span className={styles.uplink}>↑ {formatBytes(row.uplinkTotal)}</span>
        <span className={styles.downlink}>↓ {formatBytes(row.downlinkTotal)}</span>
        {share > 0 && (
          <span className={styles.shareTrack} title={`${share.toFixed(1)}%`}>
            <span className={styles.shareFill} style={{ width: `${share}%` }} />
          </span>
        )}
      </td>
      <td className={cx(styles.numCell, styles.durationCell)} title={createdAt > 0 ? formatClockTime(createdAt) : ""}>
        {createdAt > 0 ? formatDurationMs(duration) : "—"}
      </td>
    </tr>
  );
});

function ConnectionDetailBody(props: { row: ConnectionRow; onClose: () => void }) {
  const api = useApi();
  const { t, language } = useI18n();
  const row = props.row;
  const connection = row.connection;
  const active = row.closedAt === null;
  const chain = [...connection.chainList].reverse();
  return (
    <>
      <div className="hint" style={{ fontFamily: "var(--font-mono)" }}>
        {connection.id}
      </div>
      <DetailSection title={t("Traffic")}>
        <Line label={t("Created at")} value={formatDateTime(Number(connection.createdAt), language)} />
        {row.closedAt !== null && (
          <Line label={t("Closed at")} value={formatDateTime(row.closedAt, language)} />
        )}
        <Line label={t("Uplink")} value={formatBytes(row.uplinkTotal)} />
        <Line label={t("Downlink")} value={formatBytes(row.downlinkTotal)} />
      </DetailSection>
      <DetailSection title={t("Metadata")}>
        <Line label={t("Inbound")} value={connection.inbound} />
        <Line label={t("Inbound type")} value={connection.inboundType} />
        <Line label={t("IP version")} value={connection.ipVersion > 0 ? `IPv${connection.ipVersion}` : ""} />
        <Line label={t("Network")} value={connection.network.toUpperCase()} />
        <Line label={t("Source")} value={connection.source} />
        <Line label={t("Destination")} value={connection.destination} />
        <Line label={t("Domain")} value={connection.domain} />
        <Line label={t("Protocol")} value={connection.protocol} />
        <Line label={t("User")} value={connection.user} />
        <Line label={t("From outbound")} value={connection.fromOutbound} />
        <Line label={t("Match rule")} value={connection.rule} />
        <Line label={t("Outbound")} value={connection.outbound} />
        <Line label={t("Outbound type")} value={connection.outboundType} />
        {chain.length > 1 && <Line label={t("Chain")} value={chain.join(" / ")} />}
      </DetailSection>
      {connection.processInfo && (
        <DetailSection title={t("Process")}>
          <Line
            label={t("Process")}
            value={`${connection.processInfo.processPath} (${connection.processInfo.processId})`}
          />
          <Line label={t("User")} value={connection.processInfo.userName} />
        </DetailSection>
      )}
      {active && (
        <>
          <hr className={styles.divider} />
          <div className="row-actions">
            <Button
              variant="danger"
              onClick={() => {
                void api.closeConnection(connection.id).catch(showError);
                props.onClose();
              }}
            >
              <Icon name="close" size={13} />
              {t("Close connection")}
            </Button>
          </div>
        </>
      )}
    </>
  );
}

function Line(props: { label: string; value: string }) {
  if (props.value === "") {
    return null;
  }
  return <DataLine label={props.label} value={props.value} mono />;
}

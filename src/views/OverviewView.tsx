import { Code } from "@connectrpc/connect";
import { useId, useMemo, useRef, useState } from "react";

import { formatBytes, formatDateTime, formatMemoryBytes, formatUptime } from "../api/format";
import { useStream } from "../api/stream";
import { navigate, useApi, useNow } from "../app/context";
import { useLocalDesktopHost } from "../app/desktop";
import type { DesktopHost } from "../app/desktop";
import { showError } from "../app/errorStore";
import { usePendingValue, useUnaryOnce } from "../app/hooks";
import { useI18n } from "../app/i18n";
import {
  DASHBOARD_CARDS,
  groupCardRows,
  isDashboardCardId,
  loadDashboardCardsConfig,
  moveCard,
  orderedEnabledCards,
  resetDashboardCardsConfig,
  saveDashboardCardsConfig,
  toggleCard,
  type DashboardCardsConfig,
} from "../app/dashboardCards";
import { setPendingConnectionView } from "../app/connectionPreferences";
import { Icon } from "../components/Icon";
import { PageHeader } from "../components/PageHeader";
import { StreamBanner } from "../components/StreamBanner";
import { AdaptiveSegmented, Button, Card, DataLine, Dialog, EmptyState, IconButton, Sparkline } from "../components/ui";
import { StatGrid } from "../components/StatGrid";
import { ServiceStatus_Type, type Status } from "../gen/daemon/started_service_pb";
import { DEFAULT_CONNECTION_FILTERS, groupTraffic, sortTrafficGroups } from "../lib/traffic";
import { ProfileCard, SystemProxyCard } from "./ProfileViews";
import styles from "./OverviewView.module.css";
import { cx } from "../lib/cx";

export function OverviewView() {
  const api = useApi();
  const { t } = useI18n();
  const host = useLocalDesktopHost();
  const serviceStatus = useStream(api.serviceStatus);
  const [cardsConfig, setCardsConfig] = useState<DashboardCardsConfig>(() =>
    loadDashboardCardsConfig(host !== null),
  );
  const [managing, setManaging] = useState(false);
  const statusType = serviceStatus.data.status?.status;
  const started = statusType === ServiceStatus_Type.STARTED;

  let stateLabel: string | null = null;
  if (serviceStatus.phase === "active" && !started) {
    switch (statusType) {
      case ServiceStatus_Type.STARTING:
        stateLabel = t("Service starting...");
        break;
      case ServiceStatus_Type.STOPPING:
        stateLabel = t("Service stopping...");
        break;
      case ServiceStatus_Type.FATAL:
        stateLabel = t("Service failed to start");
        break;
      default:
        stateLabel = t("Service not started");
        break;
    }
  }

  return (
    <div className="page">
      <PageHeader
        title={t("Overview")}
        actions={
          started ? (
            <IconButton
              title={t("Dashboard Items")}
              onClick={() => setManaging(true)}
            >
              <Icon name="tune" />
            </IconButton>
          ) : undefined
        }
      />
      <StreamBanner snapshot={serviceStatus} />
      {started ? (
        <OverviewCards config={cardsConfig} host={host} />
      ) : host !== null ? (
        <div className={styles.cardGrid}>
          {orderedEnabledCards(cardsConfig).includes("profile") && <ProfileCard host={host} />}
        </div>
      ) : (
        stateLabel !== null && <EmptyState icon="dashboard">{stateLabel}</EmptyState>
      )}
      {managing && (
        <CardManagementDialog
          config={cardsConfig}
          desktop={host !== null}
          onChange={(next) => {
            saveDashboardCardsConfig(next);
            setCardsConfig(() => next);
          }}
          onClose={() => setManaging(false)}
        />
      )}
    </div>
  );
}

function OverviewCards(props: { config: DashboardCardsConfig; host: DesktopHost | null }) {
  const api = useApi();
  const { t } = useI18n();
  const status = useStream(api.status);
  const clashMode = useStream(api.clashMode);
  const [currentMode, setPendingMode] = usePendingValue(clashMode.data.currentMode);

  const current = status.data.current;
  const trafficAvailable = current?.trafficAvailable ?? false;
  const modeList = clashMode.data.modeList;
  const uplinkPeak = Math.max(...status.data.uplinkHistory, 0);
  const downlinkPeak = Math.max(...status.data.downlinkHistory, 0);

  const isCardVisible = (card: string) => {
    switch (card) {
      case "systemProxy":
      case "profile":
        return props.host !== null;
      case "clashMode":
        return modeList.length > 1;
      default:
        return true;
    }
  };

  const renderCard = (card: string, wide: boolean) => {
    switch (card) {
      case "uploadTraffic":
        return (
          <Card key={card} icon="upload" title={t("Upload")} wide={wide} className={styles.uploadCard}>
            <div className={styles.metricRow}>
              <span className={styles.metric}>
                {trafficAvailable ? formatBytes(Number(current?.uplink ?? 0)) : "..."}
              </span>
              {trafficAvailable && <span className={styles.metricUnit}>/s</span>}
            </div>
            <div className={styles.metricFoot}>
              <span className={styles.metricStat}>
                <span className={styles.metricLabel}>{t("Total")}</span>
                <span className={styles.metricValue}>
                  {trafficAvailable ? formatBytes(Number(current?.uplinkTotal ?? 0)) : "..."}
                </span>
              </span>
              <span className={styles.metricStat}>
                <span className={styles.metricLabel}>{t("Peak")}</span>
                <span className={styles.metricValue}>
                  {trafficAvailable ? `${formatBytes(uplinkPeak)}/s` : "..."}
                </span>
              </span>
            </div>
            <Sparkline data={status.data.uplinkHistory} color="var(--up)" />
          </Card>
        );
      case "downloadTraffic":
        return (
          <Card key={card} icon="download" title={t("Download")} wide={wide} className={styles.downloadCard}>
            <div className={styles.metricRow}>
              <span className={styles.metric}>
                {trafficAvailable ? formatBytes(Number(current?.downlink ?? 0)) : "..."}
              </span>
              {trafficAvailable && <span className={styles.metricUnit}>/s</span>}
            </div>
            <div className={styles.metricFoot}>
              <span className={styles.metricStat}>
                <span className={styles.metricLabel}>{t("Total")}</span>
                <span className={styles.metricValue}>
                  {trafficAvailable ? formatBytes(Number(current?.downlinkTotal ?? 0)) : "..."}
                </span>
              </span>
              <span className={styles.metricStat}>
                <span className={styles.metricLabel}>{t("Peak")}</span>
                <span className={styles.metricValue}>
                  {trafficAvailable ? `${formatBytes(downlinkPeak)}/s` : "..."}
                </span>
              </span>
            </div>
            <Sparkline data={status.data.downlinkHistory} color="var(--down)" />
          </Card>
        );
      case "traffic":
        return (
          <TrafficChartCard
            key={card}
            current={current}
            uplinkHistory={status.data.uplinkHistory}
            downlinkHistory={status.data.downlinkHistory}
            wide={wide}
          />
        );
      case "topOutbound":
        return <TopOutboundCard key={card} wide={wide} />;
      case "status":
        return (
          <Card key={card} icon="bug_report" title={t("Status")} wide={wide}>
            <DataLine label={t("Memory")} value={current ? formatMemoryBytes(current.memory) : "..."} />
            <DataLine label={t("Goroutines")} value={current ? current.goroutines : "..."} />
          </Card>
        );
      case "connections":
        return (
          <Card key={card} icon="cable" title={t("Connections")} wide={wide}>
            <DataLine label={t("Inbound")} value={current ? current.connectionsIn : "..."} />
            <DataLine label={t("Outbound")} value={current ? current.connectionsOut : "..."} />
          </Card>
        );
      case "systemProxy":
        if (props.host === null) {
          return null;
        }
        return <SystemProxyCard key={card} host={props.host} />;
      case "clashMode":
        if (modeList.length <= 1) {
          return null;
        }
        return (
          <Card key={card} icon="route" title={t("Mode")} wide>
            <AdaptiveSegmented
              options={modeList.map((mode) => ({ value: mode, label: mode }))}
              value={currentMode}
              onChange={(mode) => {
                setPendingMode(mode);
                api.setClashMode(mode).catch((error: unknown) => {
                  setPendingMode(null);
                  showError(error);
                });
              }}
            />
          </Card>
        );
      case "profile":
        if (props.host === null) {
          return null;
        }
        return <ProfileCard key={card} host={props.host} />;
      default:
        return null;
    }
  };

  const visibleCards = orderedEnabledCards(props.config).filter(isCardVisible);
  const wideCards = new Set(
    groupCardRows(visibleCards)
      .filter((row) => row.length === 1)
      .flat(),
  );

  return (
    <>
      <OverviewStats current={current} />
      <div className={styles.cardGrid}>
        {visibleCards.map((card) => renderCard(card, wideCards.has(card)))}
      </div>
    </>
  );
}

function OverviewStats(props: { current: Status | null }) {
  const api = useApi();
  const { t, language } = useI18n();
  const startedAt = useUnaryOnce(() => api.getStartedAt());
  const now = useNow(1000);
  const current = props.current;
  const trafficAvailable = current?.trafficAvailable ?? false;
  const uplink = Number(current?.uplink ?? 0);
  const downlink = Number(current?.downlink ?? 0);
  const uplinkTotal = Number(current?.uplinkTotal ?? 0);
  const downlinkTotal = Number(current?.downlinkTotal ?? 0);
  return (
    <StatGrid
      items={[
        {
          label: t("Current speed"),
          icon: "speed",
          tone: "accent",
          value: trafficAvailable ? `${formatBytes(uplink + downlink)}/s` : "...",
          hint: trafficAvailable
            ? `↑ ${formatBytes(uplink)}/s · ↓ ${formatBytes(downlink)}/s`
            : undefined,
        },
        {
          label: t("Total traffic"),
          icon: "swap_vert",
          tone: "info",
          value: trafficAvailable ? formatBytes(uplinkTotal + downlinkTotal) : "...",
          hint: trafficAvailable
            ? `↑ ${formatBytes(uplinkTotal)} · ↓ ${formatBytes(downlinkTotal)}`
            : undefined,
        },
        {
          label: t("Connections"),
          icon: "cable",
          tone: "good",
          value: current ? current.connectionsIn + current.connectionsOut : "...",
          hint: current
            ? `${t("Inbound")} ${current.connectionsIn} · ${t("Outbound")} ${current.connectionsOut}`
            : undefined,
        },
        {
          label: t("Uptime"),
          icon: "schedule",
          tone: "neutral",
          value: startedAt !== null ? formatUptime(startedAt, now) : "...",
          hint:
            startedAt !== null
              ? `${t("Started at")} · ${formatDateTime(startedAt, language)}`
              : undefined,
        },
      ]}
    />
  );
}

function TrafficChartCard(props: {
  current: Status | null;
  uplinkHistory: number[];
  downlinkHistory: number[];
  wide?: boolean;
}) {
  const { t } = useI18n();
  const trafficAvailable = props.current?.trafficAvailable ?? false;
  const uplink = trafficAvailable ? Number(props.current?.uplink ?? 0) : 0;
  const downlink = trafficAvailable ? Number(props.current?.downlink ?? 0) : 0;
  const total = trafficAvailable
    ? Number(props.current?.uplinkTotal ?? 0) + Number(props.current?.downlinkTotal ?? 0)
    : 0;
  const gradientId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const width = 320;
  const height = 88;
  const capacity = 30;
  const max = Math.max(...props.uplinkHistory, ...props.downlinkHistory, 1);
  const buildPoints = (data: number[]) => {
    const offset = Math.max(0, capacity - data.length);
    return data.map((value, index) => ({
      x: (offset + index) * (width / Math.max(capacity - 1, 1)),
      y: height - 6 - (value / (max * 1.15)) * (height - 14),
    }));
  };
  const toPath = (points: { x: number; y: number }[]) =>
    points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const toArea = (points: { x: number; y: number }[]) =>
    points.length > 1
      ? `${points[0].x.toFixed(1)},${height} ${toPath(points)} ${points[points.length - 1].x.toFixed(1)},${height}`
      : "";
  const uplinkPoints = buildPoints(props.uplinkHistory);
  const downlinkPoints = buildPoints(props.downlinkHistory);
  const uplinkPath = toPath(uplinkPoints);
  const downlinkPath = toPath(downlinkPoints);
  const uplinkArea = toArea(uplinkPoints);
  const downlinkArea = toArea(downlinkPoints);
  return (
    <Card
      icon="speed"
      title={t("Traffic")}
      wide={props.wide}
      className={styles.chartCard}
      actions={
        <span className={styles.chartLegend}>
          <span className={styles.legendItem}>
            <span className={cx(styles.legendDot, styles.uplink)} />↑
          </span>
          <span className={styles.legendItem}>
            <span className={cx(styles.legendDot, styles.downlink)} />↓
          </span>
        </span>
      }
    >
      {trafficAvailable ? (
        <>
          <div className={styles.chartMetrics}>
            <span className={styles.chartMetric}>
              <span className={cx(styles.legendDot, styles.uplink)} />↑ {formatBytes(uplink)}/s
            </span>
            <span className={styles.chartMetric}>
              <span className={cx(styles.legendDot, styles.downlink)} />↓ {formatBytes(downlink)}/s
            </span>
            <span className={styles.chartTotal}>
              {t("Total traffic")} · {formatBytes(total)}
            </span>
          </div>
          <svg
            width="100%"
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            className={styles.chart}
            aria-hidden="true"
          >
            <defs>
              <linearGradient id={`${gradientId}-up`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--up)" stopOpacity="0.24" />
                <stop offset="100%" stopColor="var(--up)" stopOpacity="0" />
              </linearGradient>
              <linearGradient id={`${gradientId}-down`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--down)" stopOpacity="0.26" />
                <stop offset="100%" stopColor="var(--down)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[0.25, 0.5, 0.75].map((ratio) => (
              <line
                key={ratio}
                x1="0"
                y1={(height - 6) * ratio}
                x2={width}
                y2={(height - 6) * ratio}
                stroke="var(--border)"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <line
              x1="0"
              y1={height - 6}
              x2={width}
              y2={height - 6}
              stroke="var(--border-strong)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
            {uplinkArea !== "" && <polygon points={uplinkArea} fill={`url(#${gradientId}-up)`} />}
            {downlinkArea !== "" && (
              <polygon points={downlinkArea} fill={`url(#${gradientId}-down)`} />
            )}
            {uplinkPath !== "" && (
              <polyline
                points={uplinkPath}
                fill="none"
                stroke="var(--up)"
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {downlinkPath !== "" && (
              <polyline
                points={downlinkPath}
                fill="none"
                stroke="var(--down)"
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
        </>
      ) : (
        <div className="hint">{t("Traffic statistics are not available")}</div>
      )}
    </Card>
  );
}

function TopOutboundCard(props: { wide?: boolean }) {
  const api = useApi();
  const { t } = useI18n();
  const connections = useStream(api.connections);
  const groups = useMemo(() => {
    const active = [...connections.data.rows.values()].filter((row) => row.closedAt === null);
    return sortTrafficGroups(groupTraffic(active, "outbound"), "rate", "desc").slice(0, 5);
  }, [connections.data.rows]);
  const maxRate = Math.max(...groups.map((group) => group.uplinkRate + group.downlinkRate), 1);
  return (
    <Card
      icon="hub"
      title={t("Top Outbounds")}
      wide={props.wide}
      className={styles.topCard}
      actions={
        <IconButton
          title={t("View all")}
          onClick={() => {
            setPendingConnectionView({ view: "analysis", filters: DEFAULT_CONNECTION_FILTERS });
            navigate("connections");
          }}
        >
          <Icon name="open_in_new" />
        </IconButton>
      }
    >
      {connections.phase === "error" && connections.errorCode === Code.Unimplemented ? (
        <div className="hint">
          {t("Connection tracking requires the Clash API to be configured in the running instance.")}
        </div>
      ) : !connections.data.loaded ? (
        <div className="hint">{t("Loading...")}</div>
      ) : groups.length === 0 ? (
        <div className="hint">{t("No active connections")}</div>
      ) : (
        <div className={styles.topList}>
          {groups.map((group, index) => {
            const rate = group.uplinkRate + group.downlinkRate;
            return (
              <button
                key={group.key}
                type="button"
                className={styles.topRow}
                onClick={() => {
                  setPendingConnectionView({
                    view: "list",
                    filters: { ...DEFAULT_CONNECTION_FILTERS, outbound: group.key },
                  });
                  navigate("connections");
                }}
              >
                <span className={styles.topRank}>{index + 1}</span>
                <span className={styles.topKey} title={group.key}>
                  {group.key === "" ? t("Unknown") : group.key}
                </span>
                <span className={styles.topRate}>{formatBytes(rate)}/s</span>
                <span className={styles.topBar}>
                  <span style={{ width: `${rate > 0 ? Math.max(rate / maxRate * 100, 2) : 0}%` }} />
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function CardManagementDialog(props: {
  config: DashboardCardsConfig;
  desktop: boolean;
  onChange: (config: DashboardCardsConfig) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const enabledCards = new Set(props.config.enabled);

  const moveDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (dragIndex === null || !listRef.current) {
      return;
    }
    const rows = Array.from(listRef.current.children) as HTMLElement[];
    const target = rows.findIndex((row) => {
      const rect = row.getBoundingClientRect();
      return event.clientY >= rect.top && event.clientY < rect.bottom;
    });
    if (target >= 0 && target !== dragIndex) {
      props.onChange(moveCard(props.config, dragIndex, target));
      setDragIndex(target);
    }
  };

  return (
    <Dialog onClose={props.onClose}>
      <h3>{t("Dashboard Items")}</h3>
      <div className={styles.cardManageList} ref={listRef}>
        {props.config.order.map((card, index) => {
          if (!isDashboardCardId(card)) {
            return null;
          }
          const entry = DASHBOARD_CARDS[card];
          const permanent = entry.permanent === true;
          const enabled = permanent || enabledCards.has(card);
          return (
            <div
              key={card}
              className={cx(styles.cardManageRow, dragIndex === index && styles.dragging)}
            >
              <span
                className={styles.dragHandle}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setDragIndex(index);
                }}
                onPointerMove={moveDrag}
                onPointerUp={() => setDragIndex(null)}
                onPointerCancel={() => setDragIndex(null)}
              >
                <Icon name="drag_handle" size={14} />
              </span>
              <Icon name={entry.icon} size={15} />
              <span className={styles.cardManageTitle}>{t(entry.title)}</span>
              <button
                type="button"
                className={enabled ? "switch on" : "switch"}
                role="switch"
                aria-checked={enabled}
                aria-label={t(entry.title)}
                disabled={permanent}
                onClick={() => props.onChange(toggleCard(props.config, card))}
              />
            </div>
          );
        })}
      </div>
      <div className="row-actions dialog-actions">
        <Button
          variant="danger"
          style={{ marginInlineEnd: "auto" }}
          onClick={() => props.onChange(resetDashboardCardsConfig(props.desktop))}
        >
          {t("Reset")}
        </Button>
        <Button variant="primary" onClick={props.onClose}>
          {t("Done")}
        </Button>
      </div>
    </Dialog>
  );
}

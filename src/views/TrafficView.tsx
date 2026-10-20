import { useMemo, useState } from "react";

import { formatBytes, formatDateTime } from "../api/format";
import { useApi, useNow } from "../app/context";
import { useI18n, type MessageKey } from "../app/i18n";
import {
  clearTrafficHistory,
  loadTrafficRange,
  saveTrafficRange,
  summarizeTrafficSamples,
  TRAFFIC_RANGE_MS,
  useTrafficHistory,
  type TrafficRange,
} from "../app/trafficHistory";
import { Icon } from "../components/Icon";
import { PageHeader } from "../components/PageHeader";
import { StatGrid } from "../components/StatGrid";
import { TrafficHistoryChart } from "../components/TrafficHistoryChart";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  MenuItem,
  OthersMenu,
  Select,
} from "../components/ui";
import { csvTimestamp, downloadCsv, type CsvCell } from "../lib/csv";
import styles from "./TrafficView.module.css";

const RANGE_OPTIONS: { value: TrafficRange; label: MessageKey }[] = [
  { value: "5m", label: "Last 5 minutes" },
  { value: "30m", label: "Last 30 minutes" },
  { value: "1h", label: "Last hour" },
  { value: "6h", label: "Last 6 hours" },
  { value: "24h", label: "Last 24 hours" },
];

export function TrafficView() {
  const api = useApi();
  const { t, language } = useI18n();
  const now = useNow(10_000);
  const samples = useTrafficHistory(api);
  const [range, setRange] = useState<TrafficRange>(loadTrafficRange);
  const [confirmClear, setConfirmClear] = useState(false);

  const rangeStart = now - TRAFFIC_RANGE_MS[range];
  const rangeSamples = useMemo(
    () => samples.filter((sample) => sample.t >= rangeStart),
    [samples, rangeStart],
  );
  const summary = useMemo(
    () => summarizeTrafficSamples(rangeSamples, rangeStart, now),
    [rangeSamples, rangeStart, now],
  );
  const peaks = useMemo(
    () =>
      [...rangeSamples]
        .sort((left, right) => right.up + right.down - (left.up + left.down))
        .slice(0, 5),
    [rangeSamples],
  );
  const latest = summary.latest;
  const average = summary.averageUp + summary.averageDown;
  const hasSamples = rangeSamples.length > 0;

  const changeRange = (value: TrafficRange) => {
    setRange(value);
    saveTrafficRange(value);
  };

  const exportCsv = () => {
    const rows: CsvCell[][] = [
      [
        "timestamp",
        "iso_time",
        "uplink_bps",
        "downlink_bps",
        "connections_in",
        "connections_out",
        "memory_bytes",
        "goroutines",
      ],
      ...rangeSamples.map((sample) => [
        sample.t,
        new Date(sample.t).toISOString(),
        Math.round(sample.up),
        Math.round(sample.down),
        sample.connectionsIn,
        sample.connectionsOut,
        Math.round(sample.memory),
        sample.goroutines,
      ]),
    ];
    downloadCsv(`traffic-${csvTimestamp()}.csv`, rows);
  };

  return (
    <div className="page">
      <PageHeader
        title={t("Traffic")}
        actions={
          <OthersMenu>
            <MenuItem icon="description" onSelect={exportCsv}>
              {t("Export CSV")}
            </MenuItem>
            <div className="menu-divider" />
            <MenuItem danger icon="delete" onSelect={() => setConfirmClear(true)}>
              {t("Clear history")}
            </MenuItem>
          </OthersMenu>
        }
      />

      <div className={styles.toolbar}>
        <span className={styles.toolbarLabel}>{t("Time range")}</span>
        <Select
          inline
          options={RANGE_OPTIONS.map((option) => ({
            value: option.value,
            label: t(option.label),
          }))}
          value={range}
          onChange={changeRange}
        />
        <Badge tone="accent">
          <Icon name="schedule" size={11} />
          {t("Samples")} {summary.sampleCount}
        </Badge>
        <span className={styles.toolbarHint}>{t("Stored locally · last 24 hours")}</span>
      </div>

      <StatGrid
        items={[
          {
            label: t("Average speed"),
            icon: "speed",
            tone: "accent",
            value: hasSamples ? `${formatBytes(average)}/s` : "...",
            hint: hasSamples
              ? `↑ ${formatBytes(summary.averageUp)}/s · ↓ ${formatBytes(summary.averageDown)}/s`
              : undefined,
          },
          {
            label: t("Peak download"),
            icon: "download",
            tone: "down",
            value: hasSamples ? `${formatBytes(summary.peakDown)}/s` : "...",
          },
          {
            label: t("Peak upload"),
            icon: "upload",
            tone: "up",
            value: hasSamples ? `${formatBytes(summary.peakUp)}/s` : "...",
          },
          {
            label: t("Total traffic"),
            icon: "swap_vert",
            tone: "info",
            value: hasSamples ? formatBytes(summary.totalUp + summary.totalDown) : "...",
            hint: hasSamples
              ? `↑ ${formatBytes(summary.totalUp)} · ↓ ${formatBytes(summary.totalDown)}`
              : undefined,
          },
          {
            label: t("Connections"),
            icon: "cable",
            tone: "good",
            value:
              latest !== null ? latest.connectionsIn + latest.connectionsOut : "...",
            hint:
              latest !== null
                ? `${t("Inbound")} ${latest.connectionsIn} · ${t("Outbound")} ${latest.connectionsOut}`
                : undefined,
          },
        ]}
      />

      <Card
        icon="speed"
        title={t("Traffic history")}
        className={styles.chartCard}
        actions={
          <span className={styles.legend}>
            <span className={styles.legendItem}>
              <span className={`${styles.dot} ${styles.up}`} />↑{" "}
              {formatBytes(latest?.up ?? 0)}/s
            </span>
            <span className={styles.legendItem}>
              <span className={`${styles.dot} ${styles.down}`} />↓{" "}
              {formatBytes(latest?.down ?? 0)}/s
            </span>
          </span>
        }
      >
        {rangeSamples.length >= 2 ? (
          <TrafficHistoryChart samples={rangeSamples} height={260} />
        ) : (
          <>
            <EmptyState icon="speed">{t("Collecting traffic history...")}</EmptyState>
            <div className={styles.emptyHint}>
              {t("Keep this page open to collect samples. History is stored locally for up to 24 hours.")}
            </div>
          </>
        )}
      </Card>

      {peaks.length > 0 && (
        <Card icon="bolt" title={t("Peak samples")} className={styles.peaksCard}>
          <div className={styles.peakList}>
            {peaks.map((sample, index) => (
              <div className={styles.peakRow} key={sample.t}>
                <span className={styles.peakRank}>{index + 1}</span>
                <span className={styles.peakTime}>{formatDateTime(sample.t, language)}</span>
                <span className={`${styles.peakValue} ${styles.up}`}>
                  ↑ {formatBytes(sample.up)}/s
                </span>
                <span className={`${styles.peakValue} ${styles.down}`}>
                  ↓ {formatBytes(sample.down)}/s
                </span>
                <span className={styles.peakTotal}>
                  {formatBytes(sample.up + sample.down)}/s
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {confirmClear && (
        <Dialog onClose={() => setConfirmClear(false)}>
          <h3>{t("Clear traffic history?")}</h3>
          <p className="dialog-message">{t("This removes all locally stored traffic samples.")}</p>
          <div className="row-actions dialog-actions">
            <Button onClick={() => setConfirmClear(false)}>{t("Cancel")}</Button>
            <Button
              variant="danger"
              onClick={() => {
                clearTrafficHistory(api);
                setConfirmClear(false);
              }}
            >
              {t("Clear history")}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

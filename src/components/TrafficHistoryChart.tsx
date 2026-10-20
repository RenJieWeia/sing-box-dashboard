import { useId, useMemo, useRef, useState } from "react";

import { formatBytes, formatDateTime } from "../api/format";
import type { TrafficSample } from "../app/trafficHistory";
import { useI18n } from "../app/i18n";
import { cx } from "../lib/cx";
import styles from "./TrafficHistoryChart.module.css";

const MAX_POINTS = 480;
const PADDING = 12;
const GRID_LINES = 4;
const axisFormatters = new Map<string, Intl.DateTimeFormat>();

function axisFormatter(language: string, long: boolean): Intl.DateTimeFormat {
  const key = `${language}:${long ? "long" : "short"}`;
  let formatter = axisFormatters.get(key);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat(
      language,
      long
        ? { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }
        : { hour: "2-digit", minute: "2-digit" },
    );
    axisFormatters.set(key, formatter);
  }
  return formatter;
}

function downsample(samples: TrafficSample[], maxPoints: number): TrafficSample[] {
  if (samples.length <= maxPoints) {
    return samples;
  }
  const bucketSize = Math.ceil(samples.length / maxPoints);
  const result: TrafficSample[] = [];
  for (let index = 0; index < samples.length; index += bucketSize) {
    const bucket = samples.slice(index, index + bucketSize);
    let t = 0;
    let up = 0;
    let down = 0;
    for (const sample of bucket) {
      t += sample.t;
      up += sample.up;
      down += sample.down;
    }
    result.push({
      t: t / bucket.length,
      up: up / bucket.length,
      down: down / bucket.length,
      connectionsIn: bucket[bucket.length - 1].connectionsIn,
      connectionsOut: bucket[bucket.length - 1].connectionsOut,
      memory: bucket[bucket.length - 1].memory,
      goroutines: bucket[bucket.length - 1].goroutines,
    });
  }
  return result;
}

export function TrafficHistoryChart(props: {
  samples: TrafficSample[];
  height?: number;
  className?: string;
}) {
  const { language, t } = useI18n();
  const gradientId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const plotRef = useRef<HTMLDivElement>(null);
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const height = props.height ?? 240;
  const points = useMemo(() => downsample(props.samples, MAX_POINTS), [props.samples]);
  if (points.length < 2) {
    return null;
  }

  const first = points[0];
  const last = points[points.length - 1];
  const span = Math.max(last.t - first.t, 1);
  const maxY = Math.max(...points.map((point) => Math.max(point.up, point.down)), 1);
  const x = (index: number) => (index / (points.length - 1)) * 1000;
  const y = (value: number) => height - PADDING - (value / maxY) * (height - PADDING * 2);
  const path = (key: "up" | "down") =>
    points.map((point, index) => `${x(index).toFixed(1)},${y(point[key]).toFixed(1)}`).join(" ");
  const area = (key: "up" | "down") =>
    `${x(0).toFixed(1)},${height - PADDING} ${path(key)} ${x(points.length - 1).toFixed(1)},${height - PADDING}`;
  const isLongRange = span >= 6 * 60 * 60 * 1000;
  const tickFormatter = axisFormatter(language, isLongRange);
  const formatTick = (t: number) => tickFormatter.format(new Date(t));

  const hoverIndex =
    hoverRatio === null
      ? null
      : Math.max(0, Math.min(points.length - 1, Math.round(hoverRatio * (points.length - 1))));
  const hovered = hoverIndex === null ? null : points[hoverIndex];
  const hoverX = hoverIndex === null ? 0 : x(hoverIndex);

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = plotRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) {
      return;
    }
    setHoverRatio(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)));
  };

  return (
    <div className={cx(styles.wrap, props.className)}>
      <div className={styles.plotRow} style={{ height }}>
        <div className={styles.yAxis}>
          {Array.from({ length: GRID_LINES + 1 }, (_, index) => {
            const ratio = index / GRID_LINES;
            const value = maxY * (1 - ratio);
            return (
              <span
                key={index}
                className={styles.yLabel}
                style={{ top: `${y(value)}px` }}
              >
                {formatBytes(value)}/s
              </span>
            );
          })}
        </div>
        <div
          className={styles.plot}
          ref={plotRef}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHoverRatio(null)}
        >
          <svg
            className={styles.svg}
            viewBox={`0 0 1000 ${height}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={t("Traffic history")}
          >
            <defs>
              <linearGradient id={`${gradientId}-up`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--up)" stopOpacity="0.26" />
                <stop offset="100%" stopColor="var(--up)" stopOpacity="0" />
              </linearGradient>
              <linearGradient id={`${gradientId}-down`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--down)" stopOpacity="0.3" />
                <stop offset="100%" stopColor="var(--down)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {Array.from({ length: GRID_LINES + 1 }, (_, index) => {
              const value = maxY * (1 - index / GRID_LINES);
              return (
                <line
                  key={index}
                  x1="0"
                  y1={y(value)}
                  x2="1000"
                  y2={y(value)}
                  stroke="var(--border)"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
            {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
              <line
                key={ratio}
                x1={ratio * 1000}
                y1={PADDING}
                x2={ratio * 1000}
                y2={height - PADDING}
                stroke="var(--border)"
                strokeWidth="1"
                strokeDasharray="3 5"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <polygon points={area("up")} fill={`url(#${gradientId}-up)`} />
            <polygon points={area("down")} fill={`url(#${gradientId}-down)`} />
            <polyline
              points={path("up")}
              fill="none"
              stroke="var(--up)"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            <polyline
              points={path("down")}
              fill="none"
              stroke="var(--down)"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {hovered !== null && (
            <>
              <div className={styles.hoverLine} style={{ left: `${(hoverX / 1000) * 100}%` }} />
              <span
                className={cx(styles.hoverDot, styles.up)}
                style={{ left: `${(hoverX / 1000) * 100}%`, top: `${y(hovered.up)}px` }}
              />
              <span
                className={cx(styles.hoverDot, styles.down)}
                style={{ left: `${(hoverX / 1000) * 100}%`, top: `${y(hovered.down)}px` }}
              />
              <div
                className={cx(
                  styles.tooltip,
                  hoverRatio !== null && hoverRatio > 0.65 && styles.tooltipEnd,
                  hoverRatio !== null && hoverRatio < 0.25 && styles.tooltipStart,
                )}
                style={{ left: `${(hoverX / 1000) * 100}%` }}
              >
                <span className={styles.tooltipTime}>{formatDateTime(hovered.t, language)}</span>
                <span className={styles.tooltipRow}>
                  <span className={cx(styles.dot, styles.up)} />↑ {formatBytes(hovered.up)}/s
                </span>
                <span className={styles.tooltipRow}>
                  <span className={cx(styles.dot, styles.down)} />↓ {formatBytes(hovered.down)}/s
                </span>
                <span className={styles.tooltipTotal}>
                  {formatBytes(hovered.up + hovered.down)}/s
                </span>
              </div>
            </>
          )}
        </div>
      </div>
      <div className={styles.axis}>
        <span>{formatTick(first.t)}</span>
        <span>{formatTick(first.t + span / 2)}</span>
        <span>{formatTick(last.t)}</span>
      </div>
    </div>
  );
}

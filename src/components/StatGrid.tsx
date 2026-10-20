import type { ReactNode } from "react";

import { cx } from "../lib/cx";
import { Icon, type IconName } from "./Icon";
import styles from "./StatGrid.module.css";

export type StatTone =
  | "accent"
  | "good"
  | "medium"
  | "bad"
  | "danger"
  | "info"
  | "up"
  | "down"
  | "neutral";

export interface StatItem {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: StatTone;
  icon?: IconName;
}

export function StatGrid(props: { items: StatItem[]; className?: string }) {
  return (
    <div className={cx(styles.grid, props.className)}>
      {props.items.map((item, index) => (
        <div className={cx(styles.stat, item.tone && styles[item.tone])} key={index}>
          <div className={styles.head}>
            {item.icon !== undefined && (
              <span className={styles.icon}>
                <Icon name={item.icon} size={14} />
              </span>
            )}
            <span className={styles.label}>{item.label}</span>
          </div>
          <span className={styles.value}>{item.value}</span>
          {item.hint !== undefined && <span className={styles.hint}>{item.hint}</span>}
        </div>
      ))}
    </div>
  );
}

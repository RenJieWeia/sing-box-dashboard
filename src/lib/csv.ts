import { pad2 } from "../api/format";

export type CsvCell = string | number | bigint | boolean | null | undefined;

export function escapeCsv(value: CsvCell): string {
  if (value === null || value === undefined) {
    return "";
  }
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

export function buildCsv(rows: CsvCell[][]): string {
  return rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n");
}

export function csvTimestamp(date = new Date()): string {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
}

export function downloadCsv(fileName: string, rows: CsvCell[][]): void {
  downloadText(fileName, `\ufeff${buildCsv(rows)}`, "text/csv;charset=utf-8");
}

export function downloadText(fileName: string, text: string, type = "text/plain;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

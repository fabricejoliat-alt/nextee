import type { EChartsOption, LineSeriesOption, TooltipComponentFormatterCallbackParams } from "echarts";

export const MANAGEMENT_CHART_COLORS = ["#35483b", "#899d7d", "#d9a441", "#65869a", "#b66f5d"] as const;

type ChartSeries = {
  name: string;
  data: Array<number | null>;
  color?: string;
  dashed?: boolean;
};

function baseOption(labels: string[], showLegend: boolean): EChartsOption {
  return {
    animation: true,
    animationDuration: 1100,
    animationEasing: "cubicOut",
    color: [...MANAGEMENT_CHART_COLORS],
    grid: { left: 10, right: 12, top: 20, bottom: showLegend ? 44 : 20, containLabel: true },
    legend: showLegend
      ? { bottom: 0, icon: "circle", itemWidth: 8, itemHeight: 8, textStyle: { color: "#657168", fontSize: 11, fontWeight: 600 } }
      : undefined,
    tooltip: {
      trigger: "axis",
      backgroundColor: "#fff",
      borderColor: "#e2e7e1",
      borderWidth: 1,
      textStyle: { color: "#17211b", fontWeight: 600 },
      extraCssText: "box-shadow:0 16px 32px rgba(27,45,33,.12);border-radius:12px;",
    },
    xAxis: {
      type: "category",
      data: labels,
      boundaryGap: true,
      axisLine: { lineStyle: { color: "rgba(53,72,59,0.12)" } },
      axisTick: { show: false },
      axisLabel: { color: "#7d8780", fontWeight: 700, fontSize: 11 },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: "#7d8780", fontWeight: 600, fontSize: 10 },
      splitLine: { lineStyle: { color: "rgba(53,72,59,0.08)" } },
      axisLine: { show: false },
      axisTick: { show: false },
    },
  };
}

export function buildManagementLineChartOption({
  labels,
  series,
  min,
  max,
}: {
  labels: string[];
  series: ChartSeries[];
  min?: number;
  max?: number;
}): EChartsOption {
  const option = baseOption(labels, series.length > 1);
  option.yAxis = { ...(option.yAxis as object), min, max };
  option.xAxis = { ...(option.xAxis as object), boundaryGap: false };
  option.series = series.map<LineSeriesOption>((entry, index) => ({
    type: "line",
    name: entry.name,
    data: entry.data,
    smooth: true,
    connectNulls: false,
    symbol: "circle",
    symbolSize: 7,
    lineStyle: {
      color: entry.color ?? MANAGEMENT_CHART_COLORS[index % MANAGEMENT_CHART_COLORS.length],
      width: 3,
      type: entry.dashed ? "dashed" : "solid",
    },
    itemStyle: {
      color: "#fff",
      borderColor: entry.color ?? MANAGEMENT_CHART_COLORS[index % MANAGEMENT_CHART_COLORS.length],
      borderWidth: 2,
    },
  }));
  return option;
}

export function buildManagementDualLineChartOption({
  labels,
  left,
  right,
}: {
  labels: string[];
  left: ChartSeries & { axisLabel: string };
  right: ChartSeries & { axisLabel: string };
}): EChartsOption {
  const option = baseOption(labels, true);
  option.xAxis = { ...(option.xAxis as object), boundaryGap: false };
  option.yAxis = [
    {
      type: "value",
      name: left.axisLabel,
      nameTextStyle: { color: "#7d8780", fontSize: 10, fontWeight: 600 },
      axisLabel: { color: "#7d8780", fontWeight: 600, fontSize: 10 },
      splitLine: { lineStyle: { color: "rgba(53,72,59,0.08)" } },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    {
      type: "value",
      name: right.axisLabel,
      nameTextStyle: { color: "#7d8780", fontSize: 10, fontWeight: 600 },
      axisLabel: { color: "#7d8780", fontWeight: 600, fontSize: 10 },
      splitLine: { show: false },
      axisLine: { show: false },
      axisTick: { show: false },
    },
  ];
  option.series = [left, right].map<LineSeriesOption>((entry, index) => ({
    type: "line",
    name: entry.name,
    yAxisIndex: index,
    data: entry.data,
    smooth: true,
    connectNulls: false,
    symbol: "circle",
    symbolSize: 7,
    lineStyle: {
      color: entry.color ?? MANAGEMENT_CHART_COLORS[index],
      width: 3,
      type: entry.dashed ? "dashed" : "solid",
    },
    itemStyle: {
      color: "#fff",
      borderColor: entry.color ?? MANAGEMENT_CHART_COLORS[index],
      borderWidth: 2,
    },
  }));
  return option;
}

export function buildManagementVolumeChartOption({
  labels,
  values,
  valueLabel,
  objective,
  objectiveLabel,
}: {
  labels: string[];
  values: number[];
  valueLabel: string;
  objective?: Array<number | null>;
  objectiveLabel?: string;
}): EChartsOption {
  const hasObjective = Boolean(objective?.some((value) => Number(value ?? 0) > 0));
  const option = baseOption(labels, hasObjective);
  if (hasObjective && objectiveLabel) {
    const dashedLegendIcon = `image://data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="18" height="8" viewBox="0 0 18 8"><path d="M1 4h16" fill="none" stroke="${MANAGEMENT_CHART_COLORS[2]}" stroke-width="2" stroke-dasharray="4 3" stroke-linecap="round"/></svg>`)}`;
    option.legend = {
      bottom: 0,
      itemWidth: 18,
      itemHeight: 8,
      textStyle: { color: "#657168", fontSize: 11, fontWeight: 600 },
      data: [
        { name: valueLabel, icon: "roundRect" },
        { name: objectiveLabel, icon: dashedLegendIcon },
      ],
    };
    const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character] ?? character);
    option.tooltip = {
      ...(option.tooltip as object),
      formatter: (params: TooltipComponentFormatterCallbackParams) => {
        const points = Array.isArray(params) ? params : [params];
        const title = escapeHtml(String(points[0]?.name ?? ""));
        const rows = points.filter((point) => point.value != null).map((point) => {
          const isObjective = point.seriesName === objectiveLabel;
          const marker = isObjective
            ? `<span style="display:inline-block;width:18px;flex:0 0 18px;border-top:2px dashed ${MANAGEMENT_CHART_COLORS[2]}"></span>`
            : `<span style="display:inline-block;width:10px;height:10px;flex:0 0 10px;border-radius:3px;background:${MANAGEMENT_CHART_COLORS[1]}"></span>`;
          const name = escapeHtml(String(point.seriesName ?? ""));
          const value = escapeHtml(String(point.value));
          return `<div style="display:flex;align-items:center;gap:8px;line-height:1.6">${marker}<span>${name}</span><strong style="margin-left:auto;padding-left:12px">${value}</strong></div>`;
        });
        return `<div style="min-width:150px"><div style="margin-bottom:5px;font-weight:700">${title}</div>${rows.join("")}</div>`;
      },
    };
  }
  option.series = [
    {
      type: "bar",
      name: valueLabel,
      data: values,
      barMaxWidth: 22,
      showBackground: true,
      backgroundStyle: { color: "#edf2ed", borderRadius: [7, 7, 0, 0] },
      itemStyle: { color: MANAGEMENT_CHART_COLORS[1], borderRadius: [7, 7, 0, 0] },
    },
    ...(hasObjective
      ? [{
          type: "line" as const,
          name: objectiveLabel,
          data: objective,
          symbol: "none",
          lineStyle: { color: MANAGEMENT_CHART_COLORS[2], width: 2, type: "dashed" as const },
        }]
      : []),
  ];
  return option;
}

"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts";

type ActiviteeEChartProps = {
  option: echarts.EChartsOption;
  ariaLabel: string;
  height?: number;
};

export default function ActiviteeEChart({ option, ariaLabel, height = 260 }: ActiviteeEChartProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const optionRef = useRef(option);
  optionRef.current = option;

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, undefined, { renderer: "svg" });
    chartRef.current = chart;
    chart.setOption(optionRef.current, { notMerge: true });

    let resizeFrame = 0;
    let settleFrame = 0;
    let settleTimer = 0;
    const resize = () => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => chart.resize());
    };
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    observer?.observe(ref.current);
    window.addEventListener("resize", resize);

    // Mobile layouts and web fonts can settle after ECharts' first paint.
    // A second resize guarantees every SVG series is laid out without interaction.
    resize();
    settleFrame = window.requestAnimationFrame(() => {
      resize();
      settleTimer = window.setTimeout(resize, 180);
    });

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      window.cancelAnimationFrame(resizeFrame);
      window.cancelAnimationFrame(settleFrame);
      window.clearTimeout(settleTimer);
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.setOption(option, { notMerge: true });
    const frame = window.requestAnimationFrame(() => chart.resize());
    return () => window.cancelAnimationFrame(frame);
  }, [option]);

  return <div ref={ref} role="img" aria-label={ariaLabel} style={{ width: "100%", height }} />;
}

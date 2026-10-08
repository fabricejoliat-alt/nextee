import assert from "node:assert/strict";
import test from "node:test";
import { echarts } from "../lib/activiteeEcharts.ts";

test("the shared chart renders training heatmaps and goal lines after selective imports", () => {
  const heatmap = echarts.init(null, undefined, { renderer: "svg", ssr: true, width: 480, height: 180 });
  const volume = echarts.init(null, undefined, { renderer: "svg", ssr: true, width: 480, height: 180 });
  try {
    heatmap.setOption({ animation: false, xAxis: { type: "category", data: ["Week A", "Week B"] },
      yAxis: { type: "category", data: ["Minutes"] }, visualMap: { min: 0, max: 120, show: false },
      series: [{ type: "heatmap", label: { show: true, formatter: "Minutes {@[2]}" }, data: [[0, 0, 60], [1, 0, 120]] }] });
    const cells = heatmap.renderToSVGString();
    assert.match(cells, /Minutes 60/);
    assert.match(cells, /Minutes 120/);
    volume.setOption({ animation: false, xAxis: { type: "category", data: ["Week A", "Week B"] }, yAxis: { type: "value" },
      series: [{ type: "bar", data: [60, 120], markLine: { symbol: "none", label: { show: true, formatter: "FTEM target" }, data: [{ yAxis: 90 }] } }] });
    assert.match(volume.renderToSVGString(), /FTEM target/);
  } finally { heatmap.dispose(); volume.dispose(); }
});

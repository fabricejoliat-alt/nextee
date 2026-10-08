import * as echarts from "echarts/core";
import { BarChart, HeatmapChart, LineChart } from "echarts/charts";
import { AriaComponent, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, VisualMapComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";

echarts.use([BarChart, HeatmapChart, LineChart, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, VisualMapComponent, AriaComponent, SVGRenderer]);

export { echarts };

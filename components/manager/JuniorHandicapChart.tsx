"use client";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
export default function JuniorHandicapChart({ chartData, formatHandicapDate, handicapNumber, label }: {
  chartData: Array<{date:string;handicap:number}>;
  formatHandicapDate: (date:string)=>string;
  handicapNumber: (value:number)=>string;
  label: string;
}) { return <ResponsiveContainer width="100%" height="100%"><LineChart data={chartData} margin={{ top: 10, right: 14, left: -12, bottom: 2 }}><CartesianGrid stroke="#e7ece6" strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" tickFormatter={formatHandicapDate} tick={{ fill: "#718076", fontSize: 10 }} axisLine={{ stroke: "#dfe6dd" }} tickLine={false} minTickGap={28} /><YAxis domain={["dataMin - 1", "dataMax + 1"]} tick={{ fill: "#718076", fontSize: 10 }} axisLine={false} tickLine={false} width={42} /><Tooltip labelFormatter={(label) => formatHandicapDate(String(label))} formatter={(value) => [handicapNumber(Number(value)), label]} contentStyle={{ border: "1px solid #dfe6dd", borderRadius: 10, fontSize: 12, boxShadow: "0 8px 20px rgba(27,45,33,.08)" }} /><Line type="monotone" dataKey="handicap" stroke="#607b5b" strokeWidth={2.5} dot={{ r: 4, fill: "#607b5b", strokeWidth: 0 }} activeDot={{ r: 5 }} /></LineChart></ResponsiveContainer>; }

import { BatteryCharging, Gauge, Heart, type LucideProps } from "lucide-react";

const defaults = { "aria-hidden": true, strokeWidth: 2.15 } as const;

export function MotivationIcon(props: LucideProps) {
  return <BatteryCharging {...defaults} {...props} />;
}

export function DifficultyIcon(props: LucideProps) {
  return <Gauge {...defaults} {...props} />;
}

export function SatisfactionIcon(props: LucideProps) {
  return <Heart {...defaults} {...props} />;
}

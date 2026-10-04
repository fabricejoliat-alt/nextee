import Image from "next/image";

export default function RulesVisual({ priority = false }: { priority?: boolean }) {
  return (
    <Image
      src="/images/learning/golf-rules.webp"
      alt=""
      fill
      sizes="(max-width: 760px) 100vw, 480px"
      unoptimized
      loading={priority ? "eager" : "lazy"}
    />
  );
}

"use client";

import { useLayoutEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { installPageScrollRestoration } from "@/lib/pageScrollRestoration";

export default function PageScrollRestoration() {
  const pathname = usePathname(), params = useSearchParams();
  const controller = useRef<ReturnType<typeof installPageScrollRestoration> | null>(null);
  useLayoutEffect(() => {
    const instance = installPageScrollRestoration(window);
    controller.current = instance;
    return () => { instance.dispose(); controller.current = null; };
  }, []);
  useLayoutEffect(() => { controller.current?.commit(window.location.href); }, [pathname, params]);
  return null;
}

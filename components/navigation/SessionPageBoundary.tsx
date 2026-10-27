"use client";

import { Fragment, useLayoutEffect, useState, type ReactNode } from "react";
import { CLEAR_PRESERVED_PAGES_EVENT } from "@/lib/pageScrollRestoration";

/** Never restore a previous account's retained DOM or React state. */
export default function SessionPageBoundary({ children }: { children: ReactNode }) {
  const [generation, setGeneration] = useState(0);
  useLayoutEffect(() => {
    const clear = () => setGeneration(value => value + 1);
    window.addEventListener(CLEAR_PRESERVED_PAGES_EVENT, clear);
    return () => window.removeEventListener(CLEAR_PRESERVED_PAGES_EVENT, clear);
  }, []);
  return <Fragment key={generation}>{children}</Fragment>;
}

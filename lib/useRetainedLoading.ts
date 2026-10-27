"use client";

import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";

/** Keep rendered data visible during refreshes, including Activity restoration.
 * A changed account/child/organization must remount its scoped shell.
 */
export function useRetainedLoading(initial = true): [boolean, Dispatch<SetStateAction<boolean>>] {
  const [loading, setLoading] = useState(initial);
  const completed = useRef(false);
  const update = useCallback<Dispatch<SetStateAction<boolean>>>((value) => {
    setLoading(previous => {
      const next = typeof value === "function" ? value(previous) : value;
      if (!next) completed.current = true;
      return next && completed.current ? previous : next;
    });
  }, []);
  return [loading, update];
}

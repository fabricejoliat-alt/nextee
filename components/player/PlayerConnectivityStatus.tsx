"use client";

import { useEffect, useRef, useState } from "react";
import { CloudOff, Wifi } from "lucide-react";

type ConnectivityState = "online" | "offline" | "restored";

export default function PlayerConnectivityStatus() {
  const [state, setState] = useState<ConnectivityState>("online");
  const wasOffline = useRef(false);

  useEffect(() => {
    let restoredTimer: ReturnType<typeof setTimeout> | null = null;

    const markOffline = () => {
      wasOffline.current = true;
      if (restoredTimer) clearTimeout(restoredTimer);
      setState("offline");
    };
    const markOnline = () => {
      if (!wasOffline.current) {
        setState("online");
        return;
      }
      wasOffline.current = false;
      setState("restored");
      restoredTimer = setTimeout(() => setState("online"), 4000);
    };

    if (navigator.onLine) markOnline();
    else markOffline();
    window.addEventListener("offline", markOffline);
    window.addEventListener("online", markOnline);
    return () => {
      if (restoredTimer) clearTimeout(restoredTimer);
      window.removeEventListener("offline", markOffline);
      window.removeEventListener("online", markOnline);
    };
  }, []);

  if (state === "online") return null;

  return (
    <div
      className={`player-connectivity player-connectivity--${state}`}
      role="status"
      aria-live="polite"
    >
      {state === "offline" ? <CloudOff size={17} aria-hidden="true" /> : <Wifi size={17} aria-hidden="true" />}
      <span>
        {state === "offline"
          ? "Hors ligne — certaines données et actions sont indisponibles. Ne fermez pas un formulaire non enregistré."
          : "Connexion rétablie."}
      </span>
    </div>
  );
}

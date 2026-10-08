"use client";

import { createContext } from "react";
import type { InitialPlayerHomeRead } from "@/lib/playerHomeBootstrap";

export const PlayerHomeBootstrapContext = createContext<InitialPlayerHomeRead | null>(null);

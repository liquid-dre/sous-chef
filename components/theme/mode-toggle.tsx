"use client";

import { Moon, Sun } from "lucide-react";
import { useThemeMode } from "@/components/theme/theme-provider";
import { Button } from "@/components/ui/button";

export function ModeToggle() {
  const { mode, setMode } = useThemeMode();
  const next = mode === "dark" ? "light" : "dark";
  return (
    <Button
      variant="outline"
      size="icon"
      aria-label={`Switch to ${next} mode`}
      onClick={() => setMode(next)}
    >
      {mode === "dark" ? <Sun aria-hidden /> : <Moon aria-hidden />}
    </Button>
  );
}

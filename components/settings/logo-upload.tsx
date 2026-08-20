"use client";

import * as React from "react";
import { ImagePlus } from "lucide-react";

/**
 * A quiet drop-well. The local preview is instant (object URL); the actual
 * upload happens in the container's handler and may fail plainly — e.g.
 * before SETUP.md is completed — without eating her image preview.
 */
export function LogoUpload({
  currentUrl,
  disabled,
  onSelect,
}: {
  currentUrl: string | null;
  disabled?: boolean;
  onSelect: (file: File, localUrl: string) => Promise<void>;
}) {
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="flex size-16 items-center justify-center overflow-hidden rounded-md border border-dashed bg-muted/40 text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
        aria-label={currentUrl ? "Replace logo" : "Add a logo"}
      >
        {currentUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- object URL preview
          <img src={currentUrl} alt="Current logo" className="size-full object-cover" />
        ) : (
          <ImagePlus aria-hidden className="size-5" strokeWidth={1.5} />
        )}
      </button>
      <div className="flex flex-col gap-0.5">
        <p className="type-caption text-muted-foreground">
          Square works best. It sits on the invoice header.
        </p>
        {error && (
          <p className="type-caption text-loss-foreground" role="alert">
            {error}
          </p>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setError(null);
          const localUrl = URL.createObjectURL(file);
          try {
            await onSelect(file, localUrl);
          } catch {
            setError(
              "The image is showing but couldn't be saved — Sous isn't connected yet.",
            );
          }
        }}
      />
    </div>
  );
}

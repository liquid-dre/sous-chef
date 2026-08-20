"use client";

import * as React from "react";
import {
  BusinessProfile,
  type ProfileData,
} from "@/components/settings/business-profile";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

/**
 * Business Profile specimen — the grading surface for this slice. Mounts the
 * REAL component with sample data and no-op saves (a 400ms pause so the
 * saving state is visible), so both chromes, the live preview, the tax lock
 * dialog and the contrast guard are reviewable without live Clerk/Convex.
 */

const SAMPLE_PROFILE: ProfileData = {
  name: "Rutendo's Kitchen",
  palette: { primary: "#2E6158", accent: "#B56E3C", tint: "#F7F3EA" },
  logoUrl: null,
  address: "14 Baines Ave, Harare",
  phone: "+263 77 234 5678",
  email: "orders@rutendos.kitchen",
  replyTo: "rutendo@rutendos.kitchen",
  socials: [{ label: "@rutendoskitchen", url: "https://instagram.com/rutendoskitchen" }],
  invoicePrefix: "RK",
  invoiceSequence: 27,
  terms: "Orders confirm on deposit. 48 hours' notice for cancellations.",
  paymentInstructions:
    "EcoCash 0770 000 000 (Rutendo M.)\nCBZ 0123 4567 8901 — Rutendo's Kitchen",
  overheadRateCentsPerHour: 800,
  defaultDepositPercent: 50,
  costDriftThresholdPercent: 10,
  taxEnabled: true,
  taxRateBp: 1550,
  taxInclusive: false,
  deliveryFeeModel: "flat",
  deliveryFeeConfig: { flatCents: 500 },
  deliveryCostCentsPerKm: 60,
  zwgDisplayEnabled: true,
  zwgRateMilli: 26_400,
  stocktakeDay: 0,
  productionHoursPerDay: 8,
  alertsMuted: false,
  disabled: false,
};

const EMPTY_PROFILE: ProfileData = {
  ...SAMPLE_PROFILE,
  name: "",
  address: null,
  phone: null,
  email: null,
  replyTo: null,
  socials: [],
  invoicePrefix: "INV",
  invoiceSequence: 0,
  terms: null,
  paymentInstructions: null,
  overheadRateCentsPerHour: 0,
  defaultDepositPercent: 0,
  deliveryFeeConfig: {},
  stocktakeDay: null,
  productionHoursPerDay: null,
};

const pause = () => new Promise<void>((r) => setTimeout(r, 400));

export default function ProfileSpecimenPage() {
  const [mode, setMode] = React.useState<"settings" | "onboarding">("settings");
  const [hasAnyOrder, setHasAnyOrder] = React.useState(true);

  return (
    <div className="min-h-dvh">
      <div className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-4 border-b bg-card px-4 py-2">
        <p className="type-label text-muted-foreground">
          Business Profile specimen — sample data, saves are pretend
        </p>
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-2">
            <Switch
              id="spec-orders"
              checked={hasAnyOrder}
              onCheckedChange={setHasAnyOrder}
            />
            <Label htmlFor="spec-orders" className="type-caption">
              Orders exist (tax lock)
            </Label>
          </div>
          <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
            <TabsList>
              <TabsTrigger value="settings">Settings</TabsTrigger>
              <TabsTrigger value="onboarding">Onboarding</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>
      <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6 md:py-12">
        <BusinessProfile
          key={mode}
          mode={mode}
          initial={mode === "onboarding" ? EMPTY_PROFILE : SAMPLE_PROFILE}
          hasAnyOrder={hasAnyOrder}
          ingredients={[]}
          onSave={pause}
          onSaveTax={pause}
          onCompleteOnboarding={pause}
          onToggleIngredientMute={pause}
          onUploadLogo={pause}
        />
      </main>
    </div>
  );
}

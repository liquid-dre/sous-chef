"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  BusinessProfile,
  type ProfileData,
  type TaxPatch,
} from "@/components/settings/business-profile";
import { RouteLoading } from "@/components/route-loading";
import type { Id } from "@/convex/_generated/dataModel";
import type { OrgPalette } from "@/lib/theme/derive";

/**
 * The Convex side of the Business Profile — everything the pure component
 * must not know. Both entry points (Settings and the welcome screen) run
 * through here, differing only in `mode`. Do not build two things.
 */
export function ProfileContainer({
  orgSlug,
  mode,
}: {
  orgSlug: string;
  mode: "onboarding" | "settings";
}) {
  const router = useRouter();
  const profile = useQuery(api.orgs.getProfile, { orgSlug });
  const updateProfile = useMutation(api.orgs.updateProfile);
  const updateTax = useMutation(api.orgs.updateTax);
  const completeOnboarding = useMutation(api.orgs.completeOnboarding);
  const setIngredientMute = useMutation(api.orgs.setIngredientAlertMute);
  const generateUploadUrl = useMutation(api.files.generateLogoUploadUrl);
  const setLogo = useMutation(api.files.setLogo);

  React.useEffect(() => {
    // Wrong door, right place: already-onboarded owners on /welcome go home.
    if (mode === "onboarding" && profile?.onboarded) {
      router.replace(`/${orgSlug}`);
    }
  }, [mode, profile?.onboarded, orgSlug, router]);

  if (profile === undefined) return <RouteLoading />;

  const initial: ProfileData = {
    name: profile.name,
    palette: profile.palette,
    logoUrl: profile.logoUrl,
    address: profile.address,
    phone: profile.phone,
    email: profile.email,
    replyTo: profile.replyTo,
    socials: profile.socials,
    invoicePrefix: profile.invoicePrefix,
    invoiceSequence: profile.invoiceSequence,
    terms: profile.terms,
    paymentInstructions: profile.paymentInstructions,
    overheadRateCentsPerHour: profile.overheadRateCentsPerHour,
    defaultDepositPercent: profile.defaultDepositPercent,
    costDriftThresholdPercent: profile.costDriftThresholdPercent,
    taxEnabled: profile.taxEnabled,
    taxRateBp: profile.taxRateBp,
    taxInclusive: profile.taxInclusive,
    deliveryFeeModel: profile.deliveryFeeModel,
    deliveryFeeConfig: profile.deliveryFeeConfig,
    deliveryCostCentsPerKm: profile.deliveryCostCentsPerKm,
    zwgDisplayEnabled: profile.zwgDisplayEnabled,
    zwgRateMilli: profile.zwgRateMilli,
    stocktakeDay: profile.stocktakeDay,
        productionHoursPerDay: profile.productionHoursPerDay,
    alertsMuted: profile.alertsMuted,
    disabled: profile.disabled,
  };

  return (
    <BusinessProfile
      mode={mode}
      initial={initial}
      hasAnyOrder={profile.hasAnyOrder}
      ingredients={profile.ingredients}
      onSave={async (patch) => {
        await updateProfile({ orgSlug, ...patch });
      }}
      onSaveTax={async (patch: TaxPatch) => {
        await updateTax({ orgSlug, ...patch });
      }}
      onCompleteOnboarding={async (data: {
        name: string;
        palette: OrgPalette;
        stocktakeDay: number;
      }) => {
        // The picker uses null to mean "cleared, derive it"; the wire format
        // says the same thing by omitting the key.
        await completeOnboarding({
          orgSlug,
          ...data,
          palette: {
            primary: data.palette.primary,
            ...(data.palette.accent ? { accent: data.palette.accent } : {}),
            ...(data.palette.tint ? { tint: data.palette.tint } : {}),
          },
        });
        router.push(`/${orgSlug}`);
      }}
      onToggleIngredientMute={async (id, muted) => {
        await setIngredientMute({
          orgSlug,
          ingredientId: id as Id<"ingredients">,
          muted,
        });
      }}
      onUploadLogo={async (file) => {
        const uploadUrl = await generateUploadUrl({ orgSlug });
        const result = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!result.ok) throw new Error("Upload failed");
        const { storageId } = (await result.json()) as {
          storageId: Id<"_storage">;
        };
        await setLogo({ orgSlug, storageId });
      }}
    />
  );
}

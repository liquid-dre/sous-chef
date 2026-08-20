"use client";

import * as React from "react";
import { Bell, ShoppingBasket } from "lucide-react";
import {
  InvoicePreview,
  type InvoicePreviewData,
} from "@/components/invoice/invoice-preview";
import { SAMPLE_INVOICE } from "@/components/invoice/sample-invoice";
import { LogoUpload } from "@/components/settings/logo-upload";
import { OrgColorPicker } from "@/components/theme/org-color-picker";
import { usePalette } from "@/components/theme/theme-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { OrgPalette } from "@/lib/theme/derive";
import { cn } from "@/lib/utils";

/**
 * The Business Profile — ONE component, two chromes (DESIGN mandate: do not
 * build two things). `mode="onboarding"` shows the four first-run fields on a
 * single screen; `mode="settings"` shows every section. Pure and
 * dependency-injected: no Convex imports; containers pass data in and
 * mutations down. The live invoice preview updates as she types, debounced,
 * fading through a 2px blur — never a snap, never two readable states.
 */

export interface ProfileData {
  name: string;
  palette: OrgPalette;
  logoUrl: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  replyTo: string | null;
  socials: { label: string; url: string }[];
  invoicePrefix: string;
  invoiceSequence: number;
  terms: string | null;
  paymentInstructions: string | null;
  overheadRateCentsPerHour: number;
  defaultDepositPercent: number;
  costDriftThresholdPercent: number;
  taxEnabled: boolean;
  taxRateBp: number;
  taxInclusive: boolean;
  deliveryFeeModel: "flat" | "perKm" | "freeAbove";
  deliveryFeeConfig: {
    flatCents?: number;
    perKmCents?: number;
    freeAboveCents?: number;
  };
  deliveryCostCentsPerKm: number;
  zwgDisplayEnabled: boolean;
  zwgRateMilli: number | null;
  stocktakeDay: number | null;
  productionHoursPerDay: number | null;
  alertsMuted: boolean;
  disabled: boolean;
}

export interface TaxPatch {
  taxEnabled?: boolean;
  taxRateBp?: number;
  taxInclusive?: boolean;
  confirmStamped?: boolean;
}

export interface IngredientMuteRow {
  id: string;
  name: string;
  alertsMuted: boolean;
}

export interface BusinessProfileProps {
  mode: "onboarding" | "settings";
  initial: ProfileData;
  hasAnyOrder: boolean;
  ingredients: IngredientMuteRow[];
  onSave: (patch: Record<string, unknown>) => Promise<void>;
  onSaveTax: (patch: TaxPatch) => Promise<void>;
  onCompleteOnboarding?: (data: {
    name: string;
    palette: OrgPalette;
    stocktakeDay: number;
  }) => Promise<void>;
  onToggleIngredientMute?: (id: string, muted: boolean) => Promise<void>;
  onUploadLogo?: (file: File) => Promise<void>;
}

// --- Parsing at the edge: strings in inputs, integers in data -------------

function dollarsToCents(raw: string): number {
  const n = Number.parseFloat(raw.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function centsToDollars(cents: number): string {
  return cents === 0 ? "" : (cents / 100).toFixed(2).replace(/\.00$/, "");
}

function percentToNumber(raw: string): number {
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Every editable field, as input-friendly strings. */
interface FormState {
  name: string;
  address: string;
  phone: string;
  email: string;
  replyTo: string;
  instagram: string;
  invoicePrefix: string;
  terms: string;
  paymentInstructions: string;
  overheadDollars: string;
  depositPercent: string;
  driftPercent: string;
  taxEnabled: boolean;
  taxRatePercent: string;
  taxInclusive: boolean;
  deliveryFeeModel: ProfileData["deliveryFeeModel"];
  flatFeeDollars: string;
  perKmDollars: string;
  freeAboveDollars: string;
  deliveryCostDollars: string;
  zwgEnabled: boolean;
  zwgRate: string;
  stocktakeDay: number | null;
  bakingHours: string;
  alertsMuted: boolean;
  logoPreviewUrl: string | null;
}

function toForm(p: ProfileData): FormState {
  return {
    name: p.name,
    address: p.address ?? "",
    phone: p.phone ?? "",
    email: p.email ?? "",
    replyTo: p.replyTo ?? "",
    instagram: p.socials[0]?.label ?? "",
    invoicePrefix: p.invoicePrefix,
    terms: p.terms ?? "",
    paymentInstructions: p.paymentInstructions ?? "",
    overheadDollars: centsToDollars(p.overheadRateCentsPerHour),
    depositPercent: p.defaultDepositPercent ? String(p.defaultDepositPercent) : "",
    driftPercent: String(p.costDriftThresholdPercent),
    taxEnabled: p.taxEnabled,
    taxRatePercent: p.taxRateBp ? String(p.taxRateBp / 100) : "",
    taxInclusive: p.taxInclusive,
    deliveryFeeModel: p.deliveryFeeModel,
    flatFeeDollars: centsToDollars(p.deliveryFeeConfig.flatCents ?? 0),
    perKmDollars: centsToDollars(p.deliveryFeeConfig.perKmCents ?? 0),
    freeAboveDollars: centsToDollars(p.deliveryFeeConfig.freeAboveCents ?? 0),
    deliveryCostDollars: centsToDollars(p.deliveryCostCentsPerKm),
    zwgEnabled: p.zwgDisplayEnabled,
    zwgRate: p.zwgRateMilli ? String(p.zwgRateMilli / 1000) : "",
    stocktakeDay: p.stocktakeDay,
    bakingHours:
      p.productionHoursPerDay != null ? String(p.productionHoursPerDay) : "",
    alertsMuted: p.alertsMuted,
    logoPreviewUrl: p.logoUrl,
  };
}

// --- Section save plumbing ------------------------------------------------

type SectionKey =
  | "identity"
  | "about"
  | "invoice"
  | "money"
  | "delivery"
  | "zwg"
  | "week"
  | "alerts";

function sectionPatch(
  key: SectionKey,
  f: FormState,
  palette: OrgPalette,
): Record<string, unknown> {
  switch (key) {
    case "identity":
      return { name: f.name.trim(), palette };
    case "about":
      return {
        address: f.address,
        phone: f.phone,
        email: f.email,
        replyTo: f.replyTo,
        socials: f.instagram
          ? [{ label: f.instagram, url: `https://instagram.com/${f.instagram.replace(/^@/, "")}` }]
          : [],
      };
    case "invoice":
      return {
        invoicePrefix: f.invoicePrefix.trim() || "INV",
        terms: f.terms,
        paymentInstructions: f.paymentInstructions,
      };
    case "money":
      return {
        overheadRateCentsPerHour: dollarsToCents(f.overheadDollars),
        defaultDepositPercent: percentToNumber(f.depositPercent),
        costDriftThresholdPercent: percentToNumber(f.driftPercent) || 10,
      };
    case "week":
      return {
        stocktakeDay: f.stocktakeDay ?? undefined,
        // Empty clears it, which puts the calendar's capacity flag back on
        // the default rather than on zero.
        productionHoursPerDay:
          f.bakingHours.trim() === "" ? null : Number(f.bakingHours),
      };
    case "delivery":
      return {
        deliveryFeeModel: f.deliveryFeeModel,
        deliveryFeeConfig: {
          ...(f.deliveryFeeModel !== "perKm" && {
            flatCents: dollarsToCents(f.flatFeeDollars),
          }),
          ...(f.deliveryFeeModel === "perKm" && {
            perKmCents: dollarsToCents(f.perKmDollars),
          }),
          ...(f.deliveryFeeModel === "freeAbove" && {
            freeAboveCents: dollarsToCents(f.freeAboveDollars),
          }),
        },
        deliveryCostCentsPerKm: dollarsToCents(f.deliveryCostDollars),
      };
    case "zwg":
      return {
        zwgDisplayEnabled: f.zwgEnabled,
        zwgRateMilli: f.zwgEnabled && f.zwgRate
          ? Math.round(Number.parseFloat(f.zwgRate) * 1000)
          : null,
      };
    case "alerts":
      return { alertsMuted: f.alertsMuted };
  }
}

// --- Preview derivation ---------------------------------------------------

function previewFrom(f: FormState, initial: ProfileData): InvoicePreviewData {
  const subtotalCents = 8300; // sample lines are fixed; used for freeAbove
  const flat = dollarsToCents(f.flatFeeDollars) || SAMPLE_INVOICE.deliveryFeeCents;
  const deliveryFeeCents =
    f.deliveryFeeModel === "perKm"
      ? dollarsToCents(f.perKmDollars) * 4 // sample delivery: 4 km
      : f.deliveryFeeModel === "freeAbove" &&
          dollarsToCents(f.freeAboveDollars) > 0 &&
          subtotalCents >= dollarsToCents(f.freeAboveDollars)
        ? 0
        : flat;
  return {
    ...SAMPLE_INVOICE,
    org: {
      name: f.name.trim() || "Your kitchen",
      logoUrl: f.logoPreviewUrl,
      address: f.address || null,
      phone: f.phone || null,
      email: f.email || null,
      socials: f.instagram ? [{ label: f.instagram, url: "" }] : [],
    },
    invoice: {
      prefix: f.invoicePrefix.trim() || "INV",
      number: initial.invoiceSequence + 1,
      revision: 0,
    },
    deliveryFeeCents,
    tax: {
      enabled: f.taxEnabled,
      rateBp: Math.round(percentToNumber(f.taxRatePercent) * 100),
      inclusive: f.taxInclusive,
    },
    depositPercent: percentToNumber(f.depositPercent) || null,
    paymentInstructions: f.paymentInstructions || null,
    terms: f.terms || null,
    zwgRateMilli:
      f.zwgEnabled && f.zwgRate
        ? Math.round(Number.parseFloat(f.zwgRate) * 1000)
        : null,
  };
}

/** Debounced value + a one-frame "swapping" flag driving the blur-crossfade. */
function useDebouncedPreview(data: InvoicePreviewData) {
  const [preview, setPreview] = React.useState(data);
  const [swapping, setSwapping] = React.useState(false);
  const serialized = JSON.stringify(data);
  const first = React.useRef(true);

  React.useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    // `data` is the value that produced `serialized`; a newer edit clears
    // this timer and schedules its own closure.
    const timer = setTimeout(() => {
      setSwapping(true);
      requestAnimationFrame(() => {
        setPreview(data);
        requestAnimationFrame(() => setSwapping(false));
      });
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- serialized IS data
  }, [serialized]);

  return { preview, swapping };
}

// --- Small field pieces ---------------------------------------------------

function Field({
  id,
  label,
  hint,
  children,
}: {
  id?: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="type-label">
        {label}
      </Label>
      {children}
      {hint && <p className="type-caption text-muted-foreground">{hint}</p>}
    </div>
  );
}

function MoneyInput({
  id,
  value,
  onChange,
  suffix,
  disabled,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <span className="numeric-sm pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">
        $
      </span>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        placeholder={placeholder ?? "0.00"}
        disabled={disabled}
        // md: variants are required — the Input base sets md:px-2.5, which
        // beats a bare pl-7/pr-16 and lets the affixes overlap the number.
        className={cn("numeric-body pl-7 md:pl-7", suffix && "pr-16 md:pr-16")}
      />
      {suffix && (
        <span className="type-caption pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground">
          {suffix}
        </span>
      )}
    </div>
  );
}

function PercentInput({
  id,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        placeholder={placeholder ?? "0"}
        disabled={disabled}
        className="numeric-body pr-8 md:pr-8"
      />
      <span className="numeric-sm pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground">
        %
      </span>
    </div>
  );
}

function SectionCard({
  title,
  description,
  dirty,
  onSave,
  disabled,
  children,
}: {
  title: string;
  description?: string;
  dirty: boolean;
  onSave: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-5 rounded-lg border bg-card p-5 md:p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="type-title">{title}</h2>
          {description && (
            <p className="type-caption mt-0.5 max-w-md text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {dirty && (
          <Button
            size="sm"
            disabled={disabled || saving}
            onClick={async () => {
              setSaving(true);
              setError(null);
              try {
                await onSave();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Couldn't save — try again.");
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        )}
      </div>
      {error && (
        <p className="type-label rounded-md bg-loss-soft p-3 text-loss-foreground" role="alert">
          {error}
        </p>
      )}
      {children}
    </section>
  );
}

function StocktakeDayPicker({
  value,
  onChange,
  disabled,
}: {
  value: number | null;
  onChange: (day: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Stocktake day">
      {WEEKDAYS.map((day, i) => (
        <button
          key={day}
          type="button"
          disabled={disabled}
          aria-pressed={value === i}
          onClick={() => onChange(i)}
          className={cn(
            "min-h-11 min-w-11 rounded-full border px-4 type-label outline-none transition-transform duration-[var(--duration-fast)] ease-out focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97] md:min-h-9",
            value === i
              ? "border-primary bg-primary text-primary-foreground"
              : "bg-card text-muted-foreground hover:bg-muted",
          )}
        >
          {day}
        </button>
      ))}
    </div>
  );
}

// --- The component --------------------------------------------------------

export function BusinessProfile({
  mode,
  initial,
  hasAnyOrder,
  ingredients,
  onSave,
  onSaveTax,
  onCompleteOnboarding,
  onToggleIngredientMute,
  onUploadLogo,
}: BusinessProfileProps) {
  const { palette, guard } = usePalette();
  const [savedBase, setSavedBase] = React.useState(initial);
  const [form, setForm] = React.useState<FormState>(() => toForm(initial));
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const readOnly = initial.disabled;
  const { preview, swapping } = useDebouncedPreview(previewFrom(form, initial));

  const baseForm = React.useMemo(() => toForm(savedBase), [savedBase]);
  const paletteDirty = JSON.stringify(palette) !== JSON.stringify(savedBase.palette);
  const isDirty = (keys: (keyof FormState)[], extra = false) =>
    extra || keys.some((k) => JSON.stringify(form[k]) !== JSON.stringify(baseForm[k]));

  const saveSection = async (key: SectionKey) => {
    const patch = sectionPatch(key, form, palette);
    await onSave(patch);
    setSavedBase((base) => ({ ...base, ...(patch as Partial<ProfileData>) }));
  };

  // -- Tax save with the lock dialog --
  const [taxConfirmOpen, setTaxConfirmOpen] = React.useState(false);
  const taxPatch = (): TaxPatch => {
    const rateBp = Math.round(percentToNumber(form.taxRatePercent) * 100);
    const p: TaxPatch = {};
    if (form.taxEnabled !== savedBase.taxEnabled) p.taxEnabled = form.taxEnabled;
    if (rateBp !== savedBase.taxRateBp) p.taxRateBp = rateBp;
    if (form.taxInclusive !== savedBase.taxInclusive) p.taxInclusive = form.taxInclusive;
    return p;
  };
  const commitTax = async (confirmStamped: boolean) => {
    const patch = taxPatch();
    await onSaveTax(confirmStamped ? { ...patch, confirmStamped } : patch);
    setSavedBase((base) => ({
      ...base,
      taxEnabled: form.taxEnabled,
      taxRateBp: Math.round(percentToNumber(form.taxRatePercent) * 100),
      taxInclusive: form.taxInclusive,
    }));
  };

  // -- Onboarding submit --
  const [opening, setOpening] = React.useState(false);
  const [onboardError, setOnboardError] = React.useState<string | null>(null);
  const canOpen =
    form.name.trim() !== "" && form.stocktakeDay !== null && guard?.ok !== false;

  const previewColumn = (
    <div className="lg:sticky lg:top-8">
      <p className="type-label mb-2 text-muted-foreground">
        Invoice preview — sample order, your details
      </p>
      <div
        aria-live="off"
        className={cn(
          "transition-[opacity,filter] duration-[var(--duration-base)] ease-out",
          swapping && "opacity-70 blur-[2px]",
        )}
      >
        <InvoicePreview data={preview} />
      </div>
    </div>
  );

  if (mode === "onboarding") {
    return (
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="flex max-w-xl flex-col gap-8">
          <div>
            <p className="type-flourish text-primary" aria-hidden>
              Sous
            </p>
            <h1 className="type-display-lg mt-1">Set your table</h1>
            <p className="type-body-lg mt-2 text-muted-foreground">
              Four things, under a minute. Everything else waits until the
              moment it&apos;s actually needed.
            </p>
          </div>

          <Field id="ob-name" label="Your kitchen's name">
            <Input
              id="ob-name"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Rutendo's Kitchen"
              autoComplete="organization"
              className="max-w-sm"
            />
          </Field>

          <div className="flex flex-col gap-1.5">
            <p className="type-label">Your colours</p>
            <p className="type-caption mb-2 text-muted-foreground">
              The whole app — and every invoice — wears them.
            </p>
            <OrgColorPicker />
          </div>

          <div className="flex flex-col gap-1.5">
            <p className="type-label">Currency</p>
            <div className="flex max-w-sm items-center justify-between rounded-md border bg-muted/40 px-3 py-2.5">
              <span className="type-body">US dollars (USD)</span>
              <span className="numeric-sm text-muted-foreground">$</span>
            </div>
            <p className="type-caption text-muted-foreground">
              All of Sous runs in USD. A ZWG line can be shown on invoices —
              Settings, whenever you want it.
            </p>
          </div>

          <Field
            label="Stocktake day"
            hint="A weekly count keeps the pantry honest. Sous reminds you the day before."
          >
            <StocktakeDayPicker
              value={form.stocktakeDay}
              onChange={(d) => set("stocktakeDay", d)}
            />
          </Field>

          {onboardError && (
            <p className="type-label rounded-md bg-loss-soft p-3 text-loss-foreground" role="alert">
              {onboardError}
            </p>
          )}

          <div>
            <Button
              size="lg"
              disabled={!canOpen || opening}
              onClick={async () => {
                if (form.stocktakeDay === null) return;
                setOpening(true);
                setOnboardError(null);
                try {
                  await onCompleteOnboarding?.({
                    name: form.name.trim(),
                    palette,
                    stocktakeDay: form.stocktakeDay,
                  });
                } catch (e) {
                  setOnboardError(
                    e instanceof Error ? e.message : "Couldn't open the kitchen — try again.",
                  );
                  setOpening(false);
                }
              }}
            >
              {opening ? "Opening…" : "Open your kitchen"}
            </Button>
          </div>
        </div>
        {previewColumn}
      </div>
    );
  }

  // ---------------------------------------------------------------- settings
  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_420px]">
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="type-display">Business profile</h1>
          <p className="type-body mt-1 text-muted-foreground">
            What Sous knows about the kitchen — and what your invoices say.
          </p>
          {readOnly && (
            <p className="type-label mt-3 rounded-md bg-warn-soft p-3 text-warn-foreground">
              This kitchen is read-only at the moment. Everything is safe;
              nothing can be changed.
            </p>
          )}
        </div>

        <SectionCard
          title="Identity"
          description="Name, logo and colours — the face of every screen and invoice."
          dirty={isDirty(["name"], paletteDirty)}
          onSave={() => saveSection("identity")}
          disabled={readOnly}
        >
          <Field id="pf-name" label="Kitchen name">
            <Input
              id="pf-name"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              disabled={readOnly}
              className="max-w-sm"
            />
          </Field>
          <Field label="Logo">
            <LogoUpload
              currentUrl={form.logoPreviewUrl}
              disabled={readOnly}
              onSelect={async (file, localUrl) => {
                set("logoPreviewUrl", localUrl);
                await onUploadLogo?.(file);
              }}
            />
          </Field>
          <div className="flex flex-col gap-1.5">
            <p className="type-label">Colours</p>
            <OrgColorPicker />
          </div>
        </SectionCard>

        <SectionCard
          title="About"
          description="Contact details, shown on the invoice header."
          dirty={isDirty(["address", "phone", "email", "replyTo", "instagram"])}
          onSave={() => saveSection("about")}
          disabled={readOnly}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <Field id="pf-address" label="Address">
              <Input id="pf-address" value={form.address} disabled={readOnly}
                onChange={(e) => set("address", e.target.value)} />
            </Field>
            <Field id="pf-phone" label="Phone">
              <Input id="pf-phone" value={form.phone} inputMode="tel" disabled={readOnly}
                onChange={(e) => set("phone", e.target.value)} className="numeric-body" />
            </Field>
            <Field id="pf-email" label="Email">
              <Input id="pf-email" value={form.email} inputMode="email" disabled={readOnly}
                onChange={(e) => set("email", e.target.value)} />
            </Field>
            <Field id="pf-replyto" label="Replies go to" hint="Emails send from Sous; answers land here.">
              <Input id="pf-replyto" value={form.replyTo} inputMode="email" disabled={readOnly}
                onChange={(e) => set("replyTo", e.target.value)} />
            </Field>
            <Field id="pf-ig" label="Instagram">
              <Input id="pf-ig" value={form.instagram} placeholder="@yourkitchen" disabled={readOnly}
                onChange={(e) => set("instagram", e.target.value)} />
            </Field>
          </div>
        </SectionCard>

        <SectionCard
          title="Invoice"
          description="Numbering never repeats; the prefix is yours."
          dirty={isDirty(["invoicePrefix", "terms", "paymentInstructions"])}
          onSave={() => saveSection("invoice")}
          disabled={readOnly}
        >
          <div className="grid gap-4 md:grid-cols-[8rem_1fr]">
            <Field id="pf-prefix" label="Prefix">
              <Input id="pf-prefix" value={form.invoicePrefix} disabled={readOnly}
                onChange={(e) => set("invoicePrefix", e.target.value.toUpperCase())}
                className="numeric-body" />
            </Field>
            <Field
              id="pf-payment"
              label="Payment instructions"
              hint="EcoCash, bank details, whatever people actually pay with — the most-read block on the invoice."
            >
              <Textarea id="pf-payment" rows={3} value={form.paymentInstructions} disabled={readOnly}
                onChange={(e) => set("paymentInstructions", e.target.value)} />
            </Field>
          </div>
          <Field id="pf-terms" label="Terms">
            <Textarea id="pf-terms" rows={2} value={form.terms} disabled={readOnly}
              onChange={(e) => set("terms", e.target.value)} />
          </Field>
        </SectionCard>

        <SectionCard
          title="Money"
          description="The rates behind every margin Sous shows you."
          dirty={isDirty(["overheadDollars", "depositPercent", "driftPercent"])}
          onSave={() => saveSection("money")}
          disabled={readOnly}
        >
          <div className="grid gap-4 md:grid-cols-3">
            <Field id="pf-overhead" label="Overhead rate"
              hint="Per production hour — your labour, gas, power. Never free.">
              <MoneyInput id="pf-overhead" value={form.overheadDollars} suffix="/ hour"
                onChange={(v) => set("overheadDollars", v)} disabled={readOnly} />
            </Field>
            <Field id="pf-deposit" label="Default deposit"
              hint="Suggested on new orders; editable there, never enforced.">
              <PercentInput id="pf-deposit" value={form.depositPercent}
                onChange={(v) => set("depositPercent", v)} disabled={readOnly} />
            </Field>
            <Field id="pf-drift" label="Cost drift threshold"
              hint="Flag when recent prices drift this far from standard cost.">
              <PercentInput id="pf-drift" value={form.driftPercent} placeholder="10"
                onChange={(v) => set("driftPercent", v)} disabled={readOnly} />
            </Field>
          </div>
        </SectionCard>

        <SectionCard
          title="Tax"
          description={
            hasAnyOrder
              ? "Orders exist, so changes need a confirm — each order keeps the tax setting it was created with."
              : "Off by default. Freely editable until your first order exists."
          }
          dirty={isDirty(["taxEnabled", "taxRatePercent", "taxInclusive"])}
          onSave={async () => {
            if (hasAnyOrder) {
              setTaxConfirmOpen(true);
              return;
            }
            await commitTax(false);
          }}
          disabled={readOnly}
        >
          <div className="flex items-center gap-2.5">
            <Switch id="pf-tax" checked={form.taxEnabled} disabled={readOnly}
              onCheckedChange={(v) => set("taxEnabled", v)} />
            <Label htmlFor="pf-tax">Charge tax on invoices</Label>
          </div>
          {form.taxEnabled && (
            <div className="grid gap-4 md:grid-cols-2">
              <Field id="pf-taxrate" label="Rate">
                <PercentInput id="pf-taxrate" value={form.taxRatePercent} placeholder="15.5"
                  onChange={(v) => set("taxRatePercent", v)} disabled={readOnly} />
              </Field>
              <Field label="Applied">
                <Select
                  value={form.taxInclusive ? "inclusive" : "exclusive"}
                  onValueChange={(v) => set("taxInclusive", v === "inclusive")}
                  disabled={readOnly}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inclusive">Included in your prices</SelectItem>
                    <SelectItem value="exclusive">Added on top</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
          )}
          <Dialog open={taxConfirmOpen} onOpenChange={setTaxConfirmOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Change tax settings?</DialogTitle>
                <DialogDescription>
                  Every order keeps the tax choice it was created with, stamped
                  at the time. This change applies to new orders only — history
                  will not change, and past invoices stay exactly as sent.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="ghost">Keep it as is</Button>
                </DialogClose>
                <Button
                  onClick={async () => {
                    await commitTax(true);
                    setTaxConfirmOpen(false);
                  }}
                >
                  Change for new orders
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </SectionCard>

        <SectionCard
          title="Delivery"
          description="What you charge — and separately, what it costs you. $5 charged minus $4 of fuel must read as $1."
          dirty={isDirty([
            "deliveryFeeModel",
            "flatFeeDollars",
            "perKmDollars",
            "freeAboveDollars",
            "deliveryCostDollars",
          ])}
          onSave={() => saveSection("delivery")}
          disabled={readOnly}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Fee model">
              <Select
                value={form.deliveryFeeModel}
                onValueChange={(v) => set("deliveryFeeModel", v as FormState["deliveryFeeModel"])}
                disabled={readOnly}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="flat">Flat fee</SelectItem>
                  <SelectItem value="perKm">Rate per km</SelectItem>
                  <SelectItem value="freeAbove">Free above a total</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {form.deliveryFeeModel !== "perKm" && (
              <Field id="pf-flat" label="Flat fee">
                <MoneyInput id="pf-flat" value={form.flatFeeDollars}
                  onChange={(v) => set("flatFeeDollars", v)} disabled={readOnly} />
              </Field>
            )}
            {form.deliveryFeeModel === "perKm" && (
              <Field id="pf-perkm" label="Rate" hint="Km typed per order, never guessed.">
                <MoneyInput id="pf-perkm" value={form.perKmDollars} suffix="/ km"
                  onChange={(v) => set("perKmDollars", v)} disabled={readOnly} />
              </Field>
            )}
            {form.deliveryFeeModel === "freeAbove" && (
              <Field id="pf-freeabove" label="Free above">
                <MoneyInput id="pf-freeabove" value={form.freeAboveDollars}
                  onChange={(v) => set("freeAboveDollars", v)} disabled={readOnly} />
              </Field>
            )}
            <Field id="pf-delcost" label="Your delivery cost"
              hint="Fuel or rider, per km — the side the customer never sees.">
              <MoneyInput id="pf-delcost" value={form.deliveryCostDollars} suffix="/ km"
                onChange={(v) => set("deliveryCostDollars", v)} disabled={readOnly} />
            </Field>
          </div>
        </SectionCard>

        <SectionCard
          title="ZWG display"
          description="A convenience line on invoices at a rate you set. A render, never a conversion — nothing stored changes."
          dirty={isDirty(["zwgEnabled", "zwgRate"])}
          onSave={() => saveSection("zwg")}
          disabled={readOnly}
        >
          <div className="flex items-center gap-2.5">
            <Switch id="pf-zwg" checked={form.zwgEnabled} disabled={readOnly}
              onCheckedChange={(v) => set("zwgEnabled", v)} />
            <Label htmlFor="pf-zwg">Show a ZWG line on invoices</Label>
          </div>
          {form.zwgEnabled && (
            <Field id="pf-zwgrate" label="Rate" hint="ZWG per 1 USD. The preview shows the line it produces.">
              <div className="relative max-w-48">
                <Input id="pf-zwgrate" value={form.zwgRate} inputMode="decimal" placeholder="26.40"
                  onChange={(e) => set("zwgRate", e.target.value)} disabled={readOnly}
                  className="numeric-body pr-20 md:pr-20" />
                <span className="type-caption pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground">
                  ZWG / $
                </span>
              </div>
            </Field>
          )}
        </SectionCard>

        {/* Both of these are facts about her week rather than about money,
            and until now neither could be changed after onboarding — the
            stocktake day was set once in the welcome flow and never again,
            which the calendar makes visible by putting it on screen. */}
        <SectionCard
          title="Your week"
          description="How the calendar plans around you."
          dirty={isDirty(["stocktakeDay", "bakingHours"])}
          onSave={() => saveSection("week")}
          disabled={readOnly}
        >
          <Field
            label="Stocktake day"
            hint="A weekly count keeps the pantry honest. It shows on the calendar."
          >
            <StocktakeDayPicker
              value={form.stocktakeDay}
              onChange={(d) => set("stocktakeDay", d)}
              disabled={readOnly}
            />
          </Field>
          <Field
            id="pf-bakinghours"
            label="A full day of baking is"
            hint="The calendar flags a day scheduled beyond this. It flags — it never stops you. Leave it blank for 8 hours."
          >
            <div className="relative w-32">
              <Input
                id="pf-bakinghours"
                value={form.bakingHours}
                inputMode="decimal"
                placeholder="8"
                disabled={readOnly}
                className="numeric-body pr-14 md:pr-14"
                onChange={(e) => set("bakingHours", e.target.value)}
              />
              <span className="type-caption pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground">
                hours
              </span>
            </div>
          </Field>
        </SectionCard>

        <SectionCard
          title="Alerts"
          description="Sous flags; you decide. Muting silences the flags, not the arithmetic."
          dirty={isDirty(["alertsMuted"])}
          onSave={() => saveSection("alerts")}
          disabled={readOnly}
        >
          <div className="flex items-center gap-2.5">
            <Switch id="pf-alertsmute" checked={!form.alertsMuted} disabled={readOnly}
              onCheckedChange={(v) => set("alertsMuted", !v)} />
            <Label htmlFor="pf-alertsmute">
              {form.alertsMuted ? "All alerts are muted" : "Alerts are on"}
            </Label>
          </div>
          {ingredients.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-md border border-dashed px-6 py-8 text-center">
              <ShoppingBasket aria-hidden className="size-5 text-muted-foreground" strokeWidth={1.5} />
              <p className="type-body text-muted-foreground">
                Per-ingredient mutes appear here as the pantry fills.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col divide-y">
              {ingredients.map((ing) => (
                <li key={ing.id} className="flex min-h-11 items-center justify-between gap-4 py-1.5">
                  <span className="type-body">{ing.name}</span>
                  <div className="flex items-center gap-2">
                    <Bell aria-hidden className={cn("size-4", ing.alertsMuted ? "text-muted-foreground" : "text-primary")} strokeWidth={1.8} />
                    <Switch
                      checked={!ing.alertsMuted}
                      disabled={readOnly}
                      aria-label={`Alerts for ${ing.name}`}
                      onCheckedChange={(v) => onToggleIngredientMute?.(ing.id, !v)}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
      {previewColumn}
    </div>
  );
}

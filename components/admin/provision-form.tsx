"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PLANS, PLAN_INTENT, PLAN_LABEL, type Plan } from "./types";

export interface ProvisionDraft {
  name: string;
  slug: string;
  ownerEmail: string;
  plan: Plan;
  foundingMember: boolean;
}

const BLANK: ProvisionDraft = {
  name: "",
  slug: "",
  ownerEmail: "",
  plan: "free",
  foundingMember: false,
};

/** Her kitchen's name is not her URL. "Rutendo's Kitchen" has an apostrophe,
 * a space and a capital in it, and all three break a slug — so this suggests
 * one and lets her correct it, rather than making her invent it. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/**
 * Creating a kitchen: the Clerk organization, the invitation, and the Sous
 * row, in that order.
 *
 * There is no self-signup in v1, so this form is the only door into Sous.
 * It says so — the button names all three things it does, because "Create"
 * would hide the fact that a real email leaves for a real person the moment
 * it is pressed.
 */
export function ProvisionForm({
  busy,
  error,
  notice,
  onSubmit,
}: {
  busy: boolean;
  error: string | null;
  notice: string | null;
  onSubmit: (draft: ProvisionDraft) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<ProvisionDraft>(BLANK);
  /** Once she edits the slug herself, the name stops driving it. */
  const [slugTouched, setSlugTouched] = React.useState(false);

  const slug = slugTouched ? draft.slug : slugify(draft.name);
  const ready =
    draft.name.trim() !== "" && slug !== "" && draft.ownerEmail.includes("@");

  if (!open) {
    return (
      <div className="flex flex-col gap-2">
        <div>
          <Button
            onClick={() => {
              setDraft(BLANK);
              setSlugTouched(false);
              setOpen(true);
            }}
          >
            <Plus aria-hidden />
            New kitchen
          </Button>
        </div>
        {notice && (
          <p className="type-label rounded-md bg-primary-soft p-3 text-primary">
            {notice}
          </p>
        )}
      </div>
    );
  }

  return (
    <section
      aria-label="New kitchen"
      className="flex flex-col gap-4 rounded-lg border bg-card p-4 md:p-5"
    >
      <h2 className="type-title">New kitchen</h2>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-name">Kitchen name</Label>
          <Input
            id="new-name"
            value={draft.name}
            placeholder="Rutendo's Kitchen"
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-slug">Slug</Label>
          <Input
            id="new-slug"
            value={slug}
            placeholder="rutendos-kitchen"
            onChange={(e) => {
              setSlugTouched(true);
              setDraft((d) => ({ ...d, slug: e.target.value }));
            }}
          />
          <p className="type-caption text-muted-foreground">
            This is the URL: /{slug || "…"}. It cannot be changed afterwards.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-email">Owner&rsquo;s email</Label>
          <Input
            id="new-email"
            type="email"
            inputMode="email"
            value={draft.ownerEmail}
            placeholder="chef@example.com"
            onChange={(e) =>
              setDraft((d) => ({ ...d, ownerEmail: e.target.value }))
            }
          />
          <p className="type-caption text-muted-foreground">
            The invitation goes here as soon as you press the button.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-plan">Tier</Label>
          <Select
            value={draft.plan}
            onValueChange={(value) =>
              setDraft((d) => ({ ...d, plan: value as Plan }))
            }
          >
            <SelectTrigger id="new-plan">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PLANS.map((plan) => (
                <SelectItem key={plan} value={plan}>
                  {PLAN_LABEL[plan]} — {PLAN_INTENT[plan]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col">
          <Label htmlFor="new-founding">Founding member</Label>
          <p className="type-caption text-muted-foreground">
            Free forever. The pilot kitchens get this.
          </p>
        </div>
        <Switch
          id="new-founding"
          checked={draft.foundingMember}
          onCheckedChange={(value) =>
            setDraft((d) => ({ ...d, foundingMember: value }))
          }
        />
      </div>

      {error && (
        <p
          className="type-label rounded-md bg-loss-soft p-3 text-loss-foreground"
          role="alert"
        >
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={!ready || busy}
          onClick={() => onSubmit({ ...draft, slug })}
        >
          {busy ? "Creating…" : "Create it and send the invitation"}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
          Not now
        </Button>
      </div>
    </section>
  );
}

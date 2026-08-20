"use client";

import * as React from "react";
import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PLANS,
  PLAN_INTENT,
  PLAN_LABEL,
  type AdminOrgRow,
  type ImpersonationRow,
  type Plan,
} from "./types";

/**
 * One kitchen: what it costs, what it is allowed to do, and who has looked at
 * it.
 *
 * A dialog rather than a route, because every action here is a single field
 * and the answer to "did that work" is the row behind it updating. A detail
 * page would be four sentences and a back button.
 *
 * Disabling confirms in place. It is the one control here that changes what
 * somebody else's business can do, and DESIGN.md §8 makes an unconfirmed
 * destructive action an outright fail — so the switch does not flip until the
 * consequence has been read.
 */
export function OrgDetail({
  row,
  history,
  busy,
  error,
  onClose,
  onPlan,
  onFoundingMember,
  onDisabled,
  onImpersonate,
  onFinishProvisioning,
}: {
  row: AdminOrgRow | null;
  history: ImpersonationRow[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onPlan: (plan: Plan) => void;
  onFoundingMember: (value: boolean) => void;
  onDisabled: (value: boolean) => void;
  onImpersonate: () => void;
  onFinishProvisioning: () => void;
}) {
  /**
   * WHICH kitchen the confirm is open for, not whether one is.
   *
   * Storing the id rather than a boolean means opening a different kitchen
   * closes the question by construction — the dialog cannot carry "are you
   * sure?" from one business across to another, and there is no effect to
   * synchronise (which the codebase's lint rules rightly refuse anyway).
   */
  const [confirmingFor, setConfirmingFor] = React.useState<string | null>(null);
  const confirmingDisable = row !== null && confirmingFor === row.orgId;
  const setConfirmingDisable = (next: boolean) =>
    setConfirmingFor(next && row ? row.orgId : null);

  return (
    <Dialog open={row !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        {row && (
          <>
            <DialogHeader>
              <DialogTitle>{row.name}</DialogTitle>
              <DialogDescription>
                /{row.slug} · <span className="numeric">{row.membersCount}</span>{" "}
                {row.membersCount === 1 ? "user" : "users"} ·{" "}
                <span className="numeric">{row.ordersThisMonth}</span> orders
                this month
              </DialogDescription>
            </DialogHeader>

            {!row.provisioned ? (
              // The half-failed provision, and the ordinary path for an org
              // created by hand in Clerk (SETUP.md §6.1).
              <div className="flex flex-col gap-3">
                <p className="type-body text-pretty text-muted-foreground">
                  This kitchen exists in Clerk but has no Sous settings yet, so
                  nobody can use it. Everything else here needs that row first.
                </p>
                <div>
                  <Button disabled={busy} onClick={onFinishProvisioning}>
                    {busy ? "Setting up…" : "Finish setup"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="org-plan">Tier</Label>
                  <Select
                    value={row.plan ?? "free"}
                    onValueChange={(value) => onPlan(value as Plan)}
                  >
                    <SelectTrigger id="org-plan">
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
                  <p className="type-caption text-muted-foreground">
                    Invisible to the kitchen and enforces nothing. The counters
                    run so that a limit set later is based on what actually
                    happened.
                  </p>
                </div>

                <div className="flex items-start justify-between gap-4">
                  <div className="flex flex-col">
                    <Label htmlFor="org-founding">Founding member</Label>
                    <p className="type-caption text-muted-foreground">
                      Free forever, whatever the tier says.
                    </p>
                  </div>
                  <Switch
                    id="org-founding"
                    checked={row.foundingMember ?? false}
                    disabled={busy}
                    onCheckedChange={onFoundingMember}
                  />
                </div>

                <div className="flex flex-col gap-2 border-t pt-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex flex-col">
                      <Label htmlFor="org-disabled">Read-only</Label>
                      <p className="type-caption text-pretty text-muted-foreground">
                        She can still open and export her invoices. She cannot
                        write anything.
                      </p>
                    </div>
                    <Switch
                      id="org-disabled"
                      checked={row.disabled ?? false}
                      disabled={busy}
                      onCheckedChange={(next) => {
                        // Turning it back ON is not destructive and needs no
                        // ceremony. Turning it off her business does.
                        if (!next) {
                          setConfirmingDisable(false);
                          onDisabled(false);
                          return;
                        }
                        setConfirmingDisable(true);
                      }}
                    />
                  </div>
                  {confirmingDisable && !row.disabled && (
                    <div className="flex flex-col gap-2 rounded-md bg-loss-soft p-3">
                      <p className="type-label text-loss-foreground">
                        Make {row.name} read-only?
                      </p>
                      <p className="type-caption text-loss-foreground">
                        Every order, payment and production log stops saving
                        immediately, on her phone as well as here. Nothing is
                        deleted and you can undo it from this screen.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={busy}
                          onClick={() => {
                            onDisabled(true);
                            setConfirmingDisable(false);
                          }}
                        >
                          Make it read-only
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirmingDisable(false)}
                        >
                          Leave it alone
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-2 border-t pt-4">
                  <div>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={onImpersonate}
                    >
                      <Eye aria-hidden />
                      View her kitchen
                    </Button>
                  </div>
                  <p className="type-caption text-pretty text-muted-foreground">
                    Read-only, for 30 minutes, with a banner she would see too.
                    Every session is listed below.
                  </p>

                  {history.length > 0 && (
                    <ul className="flex flex-col gap-1 pt-1">
                      {history.slice(0, 5).map((entry) => (
                        <li
                          key={entry.id}
                          className="type-caption text-muted-foreground"
                        >
                          <span className="numeric">
                            {new Date(entry.startedAt).toLocaleString("en-US", {
                              day: "numeric",
                              month: "short",
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </span>{" "}
                          ·{" "}
                          {entry.endedAt
                            ? `${Math.max(
                                1,
                                Math.round(
                                  (entry.endedAt - entry.startedAt) / 60000,
                                ),
                              )} min`
                            : "left open"}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {error && (
              <p
                className="type-label rounded-md bg-loss-soft p-3 text-loss-foreground"
                role="alert"
              >
                {error}
              </p>
            )}

            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>
                Done
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

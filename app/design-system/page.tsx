"use client";

import * as React from "react";
import { ChefHat, NotebookPen, ShoppingBasket, Trash2 } from "lucide-react";
import { ModeToggle } from "@/components/theme/mode-toggle";
import { OrgColorPicker } from "@/components/theme/org-color-picker";
import { EmptyState } from "@/components/empty-state";
import { Money, Margin } from "@/components/numeric/money";
import { TraceableMargin } from "@/components/numeric/traceable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SCALE_STEPS } from "@/lib/theme/derive";

function Section({
  id,
  title,
  intro,
  children,
}: {
  id: string;
  title: string;
  intro?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-h`} className="type-display-sm">
          {title}
        </h2>
        {intro && <p className="type-body max-w-2xl text-muted-foreground">{intro}</p>}
      </div>
      {children}
    </section>
  );
}

function Swatch({ name, varName }: { name: string; varName: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="h-12 w-full rounded-md border"
        style={{ backgroundColor: `var(${varName})` }}
      />
      <p className="type-caption text-muted-foreground">{name}</p>
    </div>
  );
}

function ScaleRow({ prefix, label }: { prefix: string; label: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="type-label">{label}</p>
      <div className="grid grid-cols-11 overflow-hidden rounded-md border">
        {SCALE_STEPS.map((step) => (
          <div
            key={step}
            title={`${prefix}-${step}`}
            className="h-10"
            style={{ backgroundColor: `var(--${prefix}-${step})` }}
          />
        ))}
      </div>
      <div className="flex justify-between">
        <span className="type-caption text-muted-foreground">50</span>
        <span className="type-caption text-muted-foreground">950</span>
      </div>
    </div>
  );
}

const menuRows = [
  { item: "Chocolate fudge cake", price: 32, cost: 11.6, target: 0.65 },
  { item: "Sourdough loaf", price: 8.5, cost: 2.9, target: 0.6 },
  { item: "Lemon tartlets (6)", price: 15, cost: 6.75, target: 0.6 },
  { item: "Beef pie", price: 6, cost: 4.1, target: 0.55 },
];

const cakeLayers = [
  { label: "Ingredients", amount: 8.1 },
  { label: "Packaging", amount: 1.2 },
  { label: "Overhead (2.5h)", amount: 2.3 },
];

export default function DesignSystemPage() {
  const [saved, setSaved] = React.useState(false);
  const [loadingDemo, setLoadingDemo] = React.useState(true);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-14 px-4 py-10 md:px-6 md:py-14">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="type-flourish text-primary" aria-hidden>
            Sous
          </p>
          <h1 className="type-display">Design system</h1>
          <p className="type-body max-w-xl text-muted-foreground">
            Every token, state and primitive on one page. Slices are graded
            against DESIGN.md here — a well-kept ledger, not a SaaS dashboard.
          </p>
        </div>
        <ModeToggle />
      </header>

      {/* ---------------------------------------------------------- Colours */}
      <Section
        id="colours"
        title="Colours"
        intro="The org picks up to three colours; everything else is derived in OKLCH. Semantic colours are fixed — profit, loss and alerts are never brand chrome."
      >
        <div className="grid gap-6 md:grid-cols-2">
          <ScaleRow prefix="primary" label="Primary scale (colour 1)" />
          <ScaleRow prefix="accent" label="Accent scale (colour 2)" />
        </div>
        <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
          <Swatch name="background" varName="--background" />
          <Swatch name="card" varName="--card" />
          <Swatch name="muted" varName="--muted" />
          <Swatch name="border" varName="--border" />
          <Swatch name="primary" varName="--primary" />
          <Swatch name="accent-strong" varName="--accent-strong" />
        </div>
        <div>
          <p className="type-label mb-3">Semantic — fixed, never derived</p>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-profit-soft px-3 py-1.5 type-label text-profit-foreground">
              Above target
            </span>
            <span className="rounded-full bg-loss-soft px-3 py-1.5 type-label text-loss-foreground">
              Losing money
            </span>
            <span className="rounded-full bg-warn-soft px-3 py-1.5 type-label text-warn-foreground">
              Estimates are 11 days old
            </span>
            <span className="rounded-full bg-loss px-3 py-1.5 type-label text-background">
              Milk runs out Thursday
            </span>
          </div>
        </div>
      </Section>

      {/* ----------------------------------------------------------- Picker */}
      <Section
        id="picker"
        title="Your colours"
        intro="The onboarding picker with its live contrast guard. Try a pale yellow as the main colour to see it refuse — and offer the nearest shade that works."
      >
        <div className="max-w-lg rounded-lg border bg-card p-5 md:p-6">
          <OrgColorPicker onCommit={() => setSaved(true)} />
          {saved && (
            <p className="type-label mt-3 text-profit-foreground" role="status">
              Saved. The whole page is already wearing them.
            </p>
          )}
        </div>
      </Section>

      {/* ------------------------------------------------------- Typography */}
      <Section
        id="type"
        title="Typography"
        intro="Fraunces speaks, Poppins works, Inter counts, Ephesis signs. Numbers never render in a proportional face."
      >
        <div className="flex flex-col gap-5 rounded-lg border bg-card p-5 md:p-6">
          <div className="flex flex-col gap-4">
            <p className="type-display-lg">Tuesday looks profitable</p>
            <p className="type-display">March, taken apart</p>
            <p className="type-display-sm">What the pantry is missing</p>
            <p className="type-title">Chocolate fudge cake</p>
            <p className="type-body-lg">
              Three orders this week need four batches; you have milk for one.
            </p>
            <p className="type-body">
              An order is the single source of truth for a sale. The invoice is
              a rendering of it.
            </p>
            <p className="type-label">Delivery date · Payment · Occasion</p>
            <p className="type-caption text-muted-foreground">
              Based on 34 orders since January
            </p>
            <p className="type-flourish text-accent-strong">
              thank you for ordering
            </p>
          </div>
          <Separator />
          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
            <span className="numeric-xl">$1,284.50</span>
            <span className="numeric-lg">$248.00</span>
            <span className="numeric-body">$32.00</span>
            <span className="numeric-sm">$2.74</span>
            <span className="numeric-body text-loss">($4.20)</span>
          </div>
          <p className="type-caption text-muted-foreground">
            Inter, tabular figures — columns align to the decimal even as the
            digits change.
          </p>
        </div>
      </Section>

      {/* ---------------------------------------------------------- Numbers */}
      <Section
        id="numbers"
        title="Numbers"
        intro="Money is 2dp with its symbol, margins are 0dp with theirs. Negative money is red and parenthesised. Every derived number can be taken apart — tap the margins."
      >
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Menu item</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Variable cost</TableHead>
                <TableHead className="text-right">Gross margin</TableHead>
                <TableHead className="pr-4 text-right">Target</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {menuRows.map((row) => {
                const margin = (row.price - row.cost) / row.price;
                const below = margin < row.target;
                return (
                  <TableRow key={row.item}>
                    <TableCell className="pl-4 type-body">{row.item}</TableCell>
                    <TableCell className="text-right">
                      <Money amount={row.price} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Money amount={row.cost} />
                    </TableCell>
                    <TableCell className="text-right">
                      <TraceableMargin
                        ratio={margin}
                        price={row.price}
                        kind="gross"
                        layers={[
                          { label: "Ingredients", amount: row.cost * 0.82 },
                          { label: "Packaging", amount: row.cost * 0.18 },
                        ]}
                        className={below ? "text-loss" : "text-profit"}
                      />
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <Margin ratio={row.target} className="text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border bg-card p-5">
            <p className="type-label text-muted-foreground">
              The one number this screen is about
            </p>
            <p className="mt-2">
              <TraceableMargin
                ratio={(32 - 11.6) / 32}
                price={32}
                kind="net"
                layers={cakeLayers}
                size="xl"
                className="text-profit"
              />
            </p>
            <p className="type-caption mt-1 text-muted-foreground">
              Net margin, chocolate fudge cake — tap it to take it apart.
            </p>
          </div>
          <div className="rounded-lg border bg-card p-5">
            <p className="type-label text-muted-foreground">Staleness is part of the number</p>
            <p className="numeric-lg mt-2 text-muted-foreground">≈ $46.10</p>
            <p className="type-caption mt-1 text-warn-foreground">
              Estimated from an 11-day-old stocktake — log a purchase or take a
              stocktake to firm this up.
            </p>
          </div>
        </div>
      </Section>

      {/* ---------------------------------------------------- Space & shape */}
      <Section
        id="shape"
        title="Space, shape, elevation"
        intro="A 4px grid, three radii plus round, and three elevations — resting is flat. A ledger doesn't float."
      >
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border bg-card p-5">
            <p className="type-label mb-3">Spacing — 4px grid</p>
            <div className="flex flex-col gap-2">
              {[4, 8, 12, 16, 24, 32, 48].map((step) => (
                <div key={step} className="flex items-center gap-3">
                  <span className="numeric-sm w-7 text-right text-muted-foreground">
                    {step}
                  </span>
                  <div
                    className="h-3 rounded-full bg-primary/25"
                    style={{ width: step }}
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-lg border bg-card p-5">
            <p className="type-label mb-3">Radius — sm 6 · md 10 · lg 14 · full</p>
            <div className="flex flex-wrap items-end gap-3">
              <div className="size-14 rounded-sm border bg-muted" />
              <div className="size-14 rounded-md border bg-muted" />
              <div className="size-14 rounded-lg border bg-muted" />
              <div className="size-14 rounded-full border bg-muted" />
            </div>
          </div>
          <div className="rounded-lg border bg-card p-5">
            <p className="type-label mb-3">Elevation — resting, float, overlay</p>
            <div className="flex flex-col gap-3">
              <div className="rounded-md border bg-card px-4 py-2.5 type-label">
                Resting — border only
              </div>
              <div className="rounded-md bg-card px-4 py-2.5 shadow-float type-label">
                Floating — popovers
              </div>
              <div className="rounded-md bg-card px-4 py-2.5 shadow-overlay type-label">
                Overlay — dialogs
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* ------------------------------------------------------- Components */}
      <Section
        id="components"
        title="Components"
        intro="shadcn, retuned. 44px targets on touch, press feedback at 120ms, hover only where hover exists."
      >
        <div className="flex flex-col gap-6 rounded-lg border bg-card p-5 md:p-6">
          <div className="flex flex-wrap items-center gap-3">
            <Button>Log a sale</Button>
            <Button variant="secondary">Duplicate order</Button>
            <Button variant="outline">Preview invoice</Button>
            <Button variant="ghost">Not now</Button>
            <Button variant="link">See the layers</Button>
            <Button disabled>Waiting on payment</Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="destructive">
                  <Trash2 aria-hidden data-icon="inline-start" />
                  Cancel order
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Cancel this order?</DialogTitle>
                  <DialogDescription>
                    A reason is required. Production was already logged, so its
                    cost stays on the books as waste.
                  </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="cancel-reason">Reason</Label>
                  <Input id="cancel-reason" placeholder="Customer called it off" />
                </div>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="ghost">Keep the order</Button>
                  </DialogClose>
                  <Button variant="destructive">Cancel order</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Drawer>
              <DrawerTrigger asChild>
                <Button variant="outline">Open a drawer</Button>
              </DrawerTrigger>
              <DrawerContent>
                <DrawerHeader>
                  <DrawerTitle>Log production</DrawerTitle>
                  <DrawerDescription>
                    One tray of chocolate fudge cake — actual yield below.
                  </DrawerDescription>
                </DrawerHeader>
                <div className="flex flex-col gap-2 p-4 pt-0">
                  <Label htmlFor="yield">Actual yield</Label>
                  <Input id="yield" inputMode="numeric" placeholder="12" className="numeric-body" />
                  <Button className="mt-2">Log it</Button>
                </div>
              </DrawerContent>
            </Drawer>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline">Open a popover</Button>
              </PopoverTrigger>
              <PopoverContent className="p-4">
                <p className="type-body">
                  Scales from its trigger origin, 200ms, ease-out. Never from
                  nothing.
                </p>
              </PopoverContent>
            </Popover>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="What counts as overhang?">
                    <ChefHat aria-hidden />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Units produced beyond the order.</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <Separator />
          <div className="grid gap-5 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="ds-name">Customer name</Label>
              <Input id="ds-name" placeholder="Rutendo M." />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="ds-phone">Phone (identity)</Label>
              <Input
                id="ds-phone"
                inputMode="tel"
                placeholder="+263 77 000 0000"
                aria-invalid
                defaultValue="077"
              />
              <p className="type-caption text-loss-foreground">
                That number looks short — check it before saving.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="ds-occasion">Occasion</Label>
              <Select>
                <SelectTrigger id="ds-occasion" className="w-full">
                  <SelectValue placeholder="Just because" />
                </SelectTrigger>
                <SelectContent>
                  {["Birthday", "Anniversary", "Wedding", "Church", "Corporate", "Just because"].map(
                    (o) => (
                      <SelectItem key={o} value={o.toLowerCase()}>
                        {o}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col justify-end gap-3">
              <div className="flex items-center gap-2.5">
                <Checkbox id="ds-consent" defaultChecked />
                <Label htmlFor="ds-consent">Okay to send occasional offers</Label>
              </div>
              <div className="flex items-center gap-2.5">
                <Switch id="ds-track" defaultChecked />
                <Label htmlFor="ds-track">Track this ingredient&apos;s stock</Label>
              </div>
            </div>
          </div>
          <Separator />
          <div className="flex flex-wrap items-center gap-2">
            <Badge>Unpaid</Badge>
            <Badge variant="secondary">Part-paid</Badge>
            <Badge variant="outline">Birthday</Badge>
            <span className="rounded-full bg-profit-soft px-2 py-0.5 text-xs font-medium text-profit-foreground">
              Paid
            </span>
          </div>
          <Separator />
          <Tabs defaultValue="orders">
            <TabsList>
              <TabsTrigger value="orders">Orders</TabsTrigger>
              <TabsTrigger value="payments">Payments</TabsTrigger>
              <TabsTrigger value="feedback">Feedback</TabsTrigger>
            </TabsList>
            <TabsContent value="orders" className="type-body pt-3 text-muted-foreground">
              Tab switches don&apos;t animate — she does this dozens of times a day.
            </TabsContent>
            <TabsContent value="payments" className="type-body pt-3 text-muted-foreground">
              Payment is a table, not a state.
            </TabsContent>
            <TabsContent value="feedback" className="type-body pt-3 text-muted-foreground">
              One tap on the order list logs what the customer said.
            </TabsContent>
          </Tabs>
        </div>
      </Section>

      {/* ------------------------------------------------ States of a screen */}
      <Section
        id="states"
        title="Empty, loading, error"
        intro="A new kitchen sees empty screens for a week — they are the first-week product. Skeletons take the shape of real content. Errors say what she can do."
      >
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border bg-card">
            <EmptyState
              icon={NotebookPen}
              title="No orders yet"
              body="When an order comes in, it lands here and on the calendar — with its margin worked out before you say yes."
              actionLabel="Add your first order"
            />
          </div>
          <div className="flex flex-col rounded-lg border bg-card">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <p className="type-label">Loading — skeleton in content&apos;s shape</p>
              <Switch
                aria-label="Toggle the loading demo"
                checked={loadingDemo}
                onCheckedChange={setLoadingDemo}
              />
            </div>
            <div className="flex flex-col gap-3 p-4">
              {loadingDemo ? (
                <>
                  <Skeleton className="h-5 w-3/5" />
                  <Skeleton className="h-4 w-2/5" />
                  <Skeleton className="h-4 w-4/5" />
                  <Skeleton className="h-4 w-1/2" />
                </>
              ) : (
                <>
                  <p className="type-body">Chocolate fudge cake × 2</p>
                  <p className="type-caption text-muted-foreground">
                    Friday delivery · Part-paid
                  </p>
                  <Money amount={64} />
                </>
              )}
            </div>
          </div>
          <div className="rounded-lg border bg-card">
            <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
              <ShoppingBasket aria-hidden className="size-6 text-muted-foreground" strokeWidth={1.5} />
              <h3 className="type-display-sm">The pantry didn&apos;t load</h3>
              <p className="type-body max-w-sm text-muted-foreground">
                Your stock levels are safe — this is a connection problem, not a
                data problem.
              </p>
              <Button variant="outline" className="mt-2">
                Try again
              </Button>
            </div>
          </div>
        </div>
      </Section>

      {/* ----------------------------------------------------------- Motion */}
      <Section
        id="motion"
        title="Motion"
        intro="Nothing over 300ms. Never ease-in, never scale(0). Frequent actions don't animate at all. Reduced motion collapses everything."
      >
        <div className="grid gap-4 rounded-lg border bg-card p-5 md:grid-cols-3 md:p-6">
          {[
            ["--ease-out", "enter · 200ms"],
            ["--ease-in-out", "move · 200ms"],
            ["--ease-drawer", "drawers · 260ms"],
          ].map(([token, use]) => (
            <div key={token} className="flex flex-col gap-1">
              <code className="numeric-sm">{token}</code>
              <p className="type-caption text-muted-foreground">{use}</p>
            </div>
          ))}
          <p className="type-caption text-muted-foreground md:col-span-3">
            Press any button on this page: scale(0.97), 120ms. Open the popover:
            it grows from its trigger. Open the drawer: 260ms on the drawer
            curve. That is the entire repertoire.
          </p>
        </div>
      </Section>

      <footer className="border-t pt-6">
        <p className="type-caption text-muted-foreground">
          Graded against DESIGN.md · below 8/10 is not done · the NEVER SHIP
          list has no exceptions.
        </p>
      </footer>
    </main>
  );
}

"use client";

import { SankeyChart } from "@/components/charts/sankey/sankey-chart";
import { SankeyLink } from "@/components/charts/sankey/sankey-link";
import { SankeyNode } from "@/components/charts/sankey/sankey-node";
import { SankeyTooltip } from "@/components/charts/sankey/sankey-tooltip";
import { SousChart } from "@/components/charts-sous/sous-chart";
import { formatMoneyExact } from "@/components/charts-sous/format";

/**
 * The money leak map — the most important chart in Sous.
 *
 * Revenue on the left, every outflow branching off it, profit surviving on the
 * right. The pilot is bad at arithmetic and excellent at seeing: a narrowing
 * stream says in one second what a P&L table never will, and because branch
 * width IS the leak ranking, this is evidence for the sentence above it rather
 * than a chart beside it.
 *
 * The branches are NOT clickable. The vendored Sankey has no click handlers
 * anywhere in it — `sankey-link.tsx` even sets `cursor: pointer`, which is a
 * lie the vendored code already tells. The ranked list beneath carries the
 * same order as real links, which is the version that works on a phone.
 *
 * `getLinkColor` and `useGradient` are mutually exclusive in the vendored
 * component (the gradient defs bail when either `stroke` or `getLinkColor` is
 * set), so choosing per-branch semantics means giving up the gradient. Worth
 * it: waste and discounts must wear the loss token and profit the profit
 * token, and DESIGN.md fixes both — a kitchen whose brand colour is red must
 * not have "you are losing money" rendered as brand chrome.
 */

export interface MoneyFlowData {
  nodes: { name: string; category?: "source" | "landing" | "outcome" }[];
  links: { source: number; target: number; value: number; semantic?: "loss" | "profit" }[];
}

const SEMANTIC: Record<string, string> = {
  loss: "var(--chart-loss)",
  profit: "var(--chart-profit)",
};

/** One lookup, so a branch and the node it lands on cannot disagree. */
function colourFor(data: MoneyFlowData, name: string | undefined): string {
  if (name === undefined) return "var(--chart-1)";
  const link = data.links.find((l) => data.nodes[l.target]?.name === name);
  return link?.semantic ? SEMANTIC[link.semantic] : "var(--chart-1)";
}

export function MoneyFlow({
  data,
  periodLabel,
  orderCount,
}: {
  data: MoneyFlowData;
  periodLabel: string;
  orderCount: number;
}) {
  return (
    <SousChart
      title="Where the money went"
      periodLabel={periodLabel}
      sampleSize={orderCount}
      sampleNoun="orders"
      state={data.links.length === 0 ? "empty" : "ready"}
      emptyTitle="No flows yet"
      emptyBody="Once orders are delivered, this shows what survives the trip from revenue to profit."
      scrollMinWidth={520}
      caption="Each branch is what left. The list below is the same order, and each row opens what caused it."
    >
      <SankeyChart
        data={data}
        animationDuration={200}
        aspectRatio="2 / 1.2"
        // 132 on the right, not 96: "Time & power" plus its value needs the
        // room, and a clipped label on the chart the whole screen builds
        // toward is not a rounding error.
        margin={{ left: 96, right: 132, top: 16, bottom: 16 }}
        nodeWidth={10}
        nodePadding={16}
      >
        <SankeyLink
          useGradient={false}
          // d3-sankey has replaced the index with the node object by now.
          getLinkColor={(link) =>
            colourFor(data, (link.target as unknown as { name?: string }).name)
          }
        />
        {/* Inflow-only labels: a source node would read "$0.00", and a false
            zero is worse than silence. */}
        <SankeyNode
          // The node wears the same semantic as the ribbon feeding it.
          // Without this the vendored palette lands an orange node on a teal
          // ribbon and a pale node on a red one, which reads as two different
          // encodings rather than one.
          getNodeColor={(node) => colourFor(data, (node as { name?: string }).name)}
          formatValueLabel={(v) => (v > 0 ? formatMoneyExact(v) : "")}
        />
        <SankeyTooltip />
      </SankeyChart>
    </SousChart>
  );
}

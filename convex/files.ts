import { v } from "convex/values";
import { ownerMutation } from "./lib/functions";
import { MAX_CAMPAIGN_BYTES } from "./lib/messages";

/**
 * Logo upload, two steps: the client asks for an upload URL, PUTs the file,
 * then records the storage id. Both owner-gated; the UI catches failures
 * (e.g. Convex not yet configured — SETUP.md) and says so plainly.
 */

export const generateLogoUploadUrl = ownerMutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * An upload URL for anything that is not the logo.
 *
 * Separate from `generateLogoUploadUrl` rather than a rename: that one is
 * called by Settings and the name is honest there. What this adds is a
 * CHECKED shape — Convex's upload URL accepts whatever the browser PUTs, and
 * nothing in this codebase validated a byte until now. A 40MB video uploaded
 * as a "campaign PDF" would be stored, attached to an email, and bounced by
 * every recipient's provider.
 *
 * The check is here rather than only in the UI because the UI is not a
 * boundary — the mutation is.
 */
export const generateUploadUrl = ownerMutation({
  args: {
    contentType: v.string(),
    sizeBytes: v.number(),
  },
  handler: async (ctx, { contentType, sizeBytes }) => {
    if (contentType !== "application/pdf") {
      throw new Error("That needs to be a PDF.");
    }
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      throw new Error("That file looks empty.");
    }
    if (sizeBytes > MAX_CAMPAIGN_BYTES) {
      throw new Error(
        `That PDF is ${Math.round(sizeBytes / 1024 / 1024)}MB. Keep it under ${MAX_CAMPAIGN_BYTES / 1024 / 1024}MB so it actually arrives.`,
      );
    }
    return await ctx.storage.generateUploadUrl();
  },
});

export const setLogo = ownerMutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    if (!ctx.org) throw new Error("This kitchen has not been set up yet.");
    // Orphan the old file reference rather than delete: invoices already
    // rendered may still point at it via URL until re-render.
    await ctx.db.patch(ctx.org._id, { logo: storageId });
    return null;
  },
});

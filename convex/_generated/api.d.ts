/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as alerts from "../alerts.js";
import type * as calendar from "../calendar.js";
import type * as customers from "../customers.js";
import type * as dashboard from "../dashboard.js";
import type * as feedback from "../feedback.js";
import type * as files from "../files.js";
import type * as ingredients from "../ingredients.js";
import type * as invoices from "../invoices.js";
import type * as lib_alerts from "../lib/alerts.js";
import type * as lib_contacts from "../lib/contacts.js";
import type * as lib_costing from "../lib/costing.js";
import type * as lib_drift from "../lib/drift.js";
import type * as lib_feedback from "../lib/feedback.js";
import type * as lib_functions from "../lib/functions.js";
import type * as lib_messages from "../lib/messages.js";
import type * as lib_optimiser from "../lib/optimiser.js";
import type * as lib_pnl from "../lib/pnl.js";
import type * as lib_portionAdapters from "../lib/portionAdapters.js";
import type * as lib_portionEvidence from "../lib/portionEvidence.js";
import type * as lib_recommendations from "../lib/recommendations.js";
import type * as lib_redact from "../lib/redact.js";
import type * as lib_requirements from "../lib/requirements.js";
import type * as lib_schedule from "../lib/schedule.js";
import type * as lib_stock from "../lib/stock.js";
import type * as lib_world from "../lib/world.js";
import type * as menuItems from "../menuItems.js";
import type * as messages from "../messages.js";
import type * as optimiserOverrides from "../optimiserOverrides.js";
import type * as orders from "../orders.js";
import type * as orgs from "../orgs.js";
import type * as payments from "../payments.js";
import type * as production from "../production.js";
import type * as purchases from "../purchases.js";
import type * as recommendations from "../recommendations.js";
import type * as stock from "../stock.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  alerts: typeof alerts;
  calendar: typeof calendar;
  customers: typeof customers;
  dashboard: typeof dashboard;
  feedback: typeof feedback;
  files: typeof files;
  ingredients: typeof ingredients;
  invoices: typeof invoices;
  "lib/alerts": typeof lib_alerts;
  "lib/contacts": typeof lib_contacts;
  "lib/costing": typeof lib_costing;
  "lib/drift": typeof lib_drift;
  "lib/feedback": typeof lib_feedback;
  "lib/functions": typeof lib_functions;
  "lib/messages": typeof lib_messages;
  "lib/optimiser": typeof lib_optimiser;
  "lib/pnl": typeof lib_pnl;
  "lib/portionAdapters": typeof lib_portionAdapters;
  "lib/portionEvidence": typeof lib_portionEvidence;
  "lib/recommendations": typeof lib_recommendations;
  "lib/redact": typeof lib_redact;
  "lib/requirements": typeof lib_requirements;
  "lib/schedule": typeof lib_schedule;
  "lib/stock": typeof lib_stock;
  "lib/world": typeof lib_world;
  menuItems: typeof menuItems;
  messages: typeof messages;
  optimiserOverrides: typeof optimiserOverrides;
  orders: typeof orders;
  orgs: typeof orgs;
  payments: typeof payments;
  production: typeof production;
  purchases: typeof purchases;
  recommendations: typeof recommendations;
  stock: typeof stock;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};

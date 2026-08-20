// @vitest-environment node
import { describe, expect, test } from "vitest";
import { composeInvoiceEmail } from "./invoice-email";

/**
 * What can be tested without a Resend account, an API key or a verified
 * domain — which is to say, everything except the wire.
 *
 * The live send is the user's to verify (SETUP.md). What is asserted here is
 * the part that would be wrong silently: who it is addressed to, what the
 * attachment is called, and whether a void invoice still reads as a demand
 * for money.
 */

const BASE = {
  to: "tariro@example.co.zw",
  label: "RK-0128",
  orgName: "Rutendo's Kitchen",
  customerName: "Tariro Moyo",
  balanceCents: 4_000,
  totalCents: 8_000,
  invoiceUrl: "https://sous.app/i/i_abc",
  cancelled: false,
};

describe("composing the invoice email", () => {
  test("carries the label, the balance and the link", () => {
    const email = composeInvoiceEmail(BASE);
    expect(email.subject).toBe("Invoice RK-0128 from Rutendo's Kitchen");
    expect(email.text).toContain("Hi Tariro,");
    expect(email.text).toContain("The balance due is $40.00.");
    expect(email.text).toContain("https://sous.app/i/i_abc");
    expect(email.html).toContain("https://sous.app/i/i_abc");
    // Named for the invoice, because it lands among a hundred other files.
    expect(email.attachmentFilename).toBe("RK-0128.pdf");
  });

  test("a paid invoice thanks rather than demands", () => {
    const email = composeInvoiceEmail({ ...BASE, balanceCents: 0 });
    expect(email.text).toContain("paid in full");
    expect(email.text).not.toContain("balance due");
  });

  test("a cancelled invoice never asks for money", () => {
    const email = composeInvoiceEmail({
      ...BASE,
      cancelled: true,
      balanceCents: 4_000,
    });
    expect(email.subject).toContain("Cancelled");
    expect(email.text).toContain("nothing is owed");
    // Even though a balance is still on the record, the email must not read
    // as a demand — the same rule the document itself follows.
    expect(email.text).not.toContain("$40.00");
  });

  test("a customer with no name is greeted, not addressed as null", () => {
    const email = composeInvoiceEmail({ ...BASE, customerName: null });
    expect(email.text.startsWith("Hello,")).toBe(true);
    expect(email.text).not.toContain("null");
  });

  test("html is escaped, so a kitchen name cannot inject markup", () => {
    const email = composeInvoiceEmail({
      ...BASE,
      orgName: `Rut<script>alert(1)</script>endo's`,
    });
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
  });
});

/**
 * The invoice email, composed.
 *
 * Pure and free of Resend, so the thing that actually matters — who it is
 * addressed to, where a reply lands, what the attachment is called — is
 * testable without an API key, a verified domain or a network.
 *
 * Deliberately plain. No layout tables, no images, no CSS: every hour spent
 * fighting Outlook's renderer is an hour not spent on the PDF, which is where
 * the design lives. The email's whole job is to carry the file and the link,
 * say what is owed, and get out of the way.
 */

export interface InvoiceEmailInput {
  to: string;
  label: string;
  orgName: string;
  customerName: string | null;
  balanceCents: number;
  totalCents: number;
  /** Absolute — an email is read anywhere, and a relative link is dead there. */
  invoiceUrl: string;
  cancelled: boolean;
}

export interface ComposedEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachmentFilename: string;
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Minimal escaping — these are names and org fields, not rich text. */
function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function composeInvoiceEmail(input: InvoiceEmailInput): ComposedEmail {
  const greeting = input.customerName
    ? `Hi ${input.customerName.split(" ")[0]},`
    : "Hello,";

  // A void invoice must not read as a demand for money, in the email any more
  // than on the document.
  const line = input.cancelled
    ? `This invoice has been cancelled — nothing is owed on it.`
    : input.balanceCents > 0
      ? `The balance due is ${money(input.balanceCents)}.`
      : `It's paid in full — thank you.`;

  const subject = input.cancelled
    ? `Cancelled: invoice ${input.label} from ${input.orgName}`
    : `Invoice ${input.label} from ${input.orgName}`;

  const text = [
    greeting,
    "",
    `Your invoice ${input.label} from ${input.orgName} is attached.`,
    line,
    "",
    `You can also view it here: ${input.invoiceUrl}`,
    "",
    `Reply to this email if anything looks wrong.`,
  ].join("\n");

  const html = [
    `<p>${escapeHtml(greeting)}</p>`,
    `<p>Your invoice <strong>${escapeHtml(input.label)}</strong> from ${escapeHtml(input.orgName)} is attached.<br>${escapeHtml(line)}</p>`,
    `<p><a href="${escapeHtml(input.invoiceUrl)}">View your invoice</a></p>`,
    `<p style="color:#6b675e;font-size:13px">Reply to this email if anything looks wrong.</p>`,
  ].join("\n");

  return {
    to: input.to,
    subject,
    text,
    html,
    // Named for the invoice, not for the system. It lands in her customer's
    // downloads folder among a hundred other files.
    attachmentFilename: `${input.label}.pdf`,
  };
}

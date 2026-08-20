import type { Metadata } from "next";
import { Ephesis, Fraunces, Inter, Poppins } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { deriveThemeVars } from "@/lib/theme/derive";
import { DEFAULT_PALETTE } from "@/lib/theme/palette";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { ConvexClientProvider } from "@/components/providers/convex-client-provider";
import "./globals.css";

/** Auth screens render before any org theme exists, so Clerk gets literal
 * values from the default Sous palette — not CSS vars, which Clerk's shade
 * computation cannot parse. */
const clerkAppearance = {
  variables: {
    colorPrimary: "#2E6158",
    colorBackground: "#fdfcfa",
    colorText: "#221f1a",
    colorTextSecondary: "#6b675e",
    colorDanger: "#b3261e",
    borderRadius: "10px",
    fontFamily: "var(--font-poppins), sans-serif",
  },
};

const poppins = Poppins({
  variable: "--font-poppins",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const ephesis = Ephesis({
  variable: "--font-ephesis",
  weight: "400",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Sous",
  description:
    "Business management for independent chefs — the truth about whether you are making money.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const themeVars = deriveThemeVars(DEFAULT_PALETTE) ?? {};
  return (
    <html
      lang="en"
      suppressHydrationWarning
      style={themeVars as React.CSSProperties}
      className={`${poppins.variable} ${fraunces.variable} ${inter.variable} ${ephesis.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        {/* `dynamic`: every surface is session-scoped, so nothing here is
            worth prerendering — and it lets the shell build on placeholder
            keys before SETUP.md has been completed. */}
        <ClerkProvider appearance={clerkAppearance} dynamic>
          <ConvexClientProvider>
            <ThemeProvider defaultPalette={DEFAULT_PALETTE}>
              {children}
            </ThemeProvider>
          </ConvexClientProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}

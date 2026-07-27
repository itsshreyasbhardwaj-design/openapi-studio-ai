import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/misc";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"], display: "swap" });
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: {
    default: "OpenAPI Studio AI — design, test and ship APIs",
    template: "%s · OpenAPI Studio AI",
  },
  description:
    "An open-source API engineering platform: design OpenAPI 3.x visually or in code, validate and lint, generate SDKs for seven languages, mock, test, document and monitor — with an AI assistant that works offline.",
  keywords: [
    "OpenAPI",
    "Swagger",
    "API design",
    "SDK generator",
    "API mock server",
    "API testing",
    "API documentation",
    "GraphQL",
  ],
  authors: [{ name: "OpenAPI Studio AI contributors" }],
  openGraph: {
    type: "website",
    title: "OpenAPI Studio AI",
    description:
      "Design, validate, mock, test, document and monitor APIs from one open-source platform.",
    siteName: "OpenAPI Studio AI",
  },
  twitter: { card: "summary_large_image", title: "OpenAPI Studio AI" },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#07080c" },
    { media: "(prefers-color-scheme: light)", color: "#f6f7fb" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
    >
      <body className="relative flex min-h-full flex-col">
        <TooltipProvider>
          <div className="relative z-10 flex min-h-full flex-1 flex-col">{children}</div>
          <Toaster
            theme="dark"
            position="bottom-right"
            toastOptions={{
              classNames: {
                toast: "glass-strong !rounded-xl !text-ink",
                description: "!text-ink-muted",
              },
            }}
          />
        </TooltipProvider>
      </body>
    </html>
  );
}

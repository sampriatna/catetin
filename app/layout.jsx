// app/layout.jsx
import { Suspense } from "react";
import BusinessProvider from "../components/layout/BusinessProvider";
import SwRegister from "../components/SwRegister";

export const metadata = {
  title: "NF3",
  description: "Buku kas digital NF",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "NF3",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/icon-192.png",
    apple: "/icon-192.png",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#185FA5",
};

export default function RootLayout({ children }) {
  return (
    <html lang="id">
      <head>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/dist/tabler-icons.min.css" />
      </head>
      <body style={{ margin: 0, fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif" }}>
        <SwRegister />
        <Suspense>
          <BusinessProvider>{children}</BusinessProvider>
        </Suspense>
      </body>
    </html>
  );
}

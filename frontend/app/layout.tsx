import type { Metadata } from "next";
import { IBM_Plex_Sans, Roboto } from "next/font/google";
import "./globals.css";

// Tipografia institucional Kaffa: IBM Plex Sans nos títulos, Roboto no texto.
const plex = IBM_Plex_Sans({
  variable: "--font-plex",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const roboto = Roboto({
  variable: "--font-roboto",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Chamado Pronto · Reboot Cafeinado",
  description: "Qualificação de chamados com o Kaffa AI Hub e atendimento em tempo real",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`${plex.variable} ${roboto.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import { IBM_Plex_Sans, Inter, Manrope, Nunito, Nunito_Sans, Roboto, Source_Sans_3, Source_Serif_4 } from "next/font/google";

import { SCRIPT_MARCA } from "@/lib/marcas";
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

// Tipografia de cada empresa cliente (globals.css escolhe pelo data-empresa). Sem preload: cada aba usa só uma.
const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"], preload: false });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"], preload: false });
const nunito = Nunito({ variable: "--font-nunito", subsets: ["latin"], preload: false });
const nunitoSans = Nunito_Sans({ variable: "--font-nunito-sans", subsets: ["latin"], preload: false });
const sourceSerif = Source_Serif_4({ variable: "--font-source-serif", subsets: ["latin"], preload: false });
const sourceSans = Source_Sans_3({ variable: "--font-source-sans", subsets: ["latin"], preload: false });

const FONTES = [plex, roboto, manrope, inter, nunito, nunitoSans, sourceSerif, sourceSans].map((f) => f.variable).join(" ");

export const metadata: Metadata = {
  title: "Chamado Pronto · Reboot Cafeinado",
  description: "Qualificação de chamados com o Kaffa AI Hub e atendimento em tempo real",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // O script do <head> aplica a marca da aba (data-empresa, depois do login) antes da primeira pintura: o React aceita o atributo.
    <html lang="pt-BR" className={`${FONTES} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_MARCA }} />
      </head>
      {/* Extensões do navegador (ColorZilla, gerenciadores de senha) injetam atributos no <body> antes do React. */}
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}

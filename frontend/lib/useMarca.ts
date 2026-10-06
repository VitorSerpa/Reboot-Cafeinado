import { useSyncExternalStore } from "react";

import { marcaDe, type Marca } from "@/lib/marcas";

/** Avisa quando `<html data-empresa>` muda (sessão conferida, e-mail digitado no login, saída). */
function assinar(aviso: () => void) {
  const observador = new MutationObserver(aviso);
  observador.observe(document.documentElement, { attributes: true, attributeFilter: ["data-empresa"] });
  return () => observador.disconnect();
}

/**
 * Marca em uso na página. A fonte da verdade é o atributo `data-empresa` do `<html>`, que o script do layout
 * aplica antes da primeira pintura e `aplicarMarca` troca depois. No servidor não há marca (identidade Kaffa).
 */
export function useMarca(): Marca | null {
  const id = useSyncExternalStore(
    assinar,
    () => document.documentElement.dataset.empresa ?? null,
    () => null,
  );
  return marcaDe(id);
}

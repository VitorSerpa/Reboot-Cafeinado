import { env } from "../config/env.js";
import { hubReal } from "./runtime.js";
import { hubSimulado } from "./simulado.js";
import type { ClienteHub } from "./tipos.js";

export const hub: ClienteHub = env.hub.modo === "real" ? hubReal : hubSimulado;

export * from "./tipos.js";

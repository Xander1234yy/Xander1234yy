export * from "./types";
export { LocalJarvis, respondLocal, matchDevices } from "./local";
export { normalize, wordsToNumbers, distance, COLORS } from "./text";
import { LocalJarvis } from "./local";
import type { JarvisProvider } from "./types";

/** Beschikbare providers. Een AI-provider kan hier later worden toegevoegd zonder de rest te wijzigen. */
export const PROVIDERS: Record<string, () => JarvisProvider> = {
  local: () => new LocalJarvis(),
};

export function getProvider(id: string | undefined): JarvisProvider {
  return (PROVIDERS[id ?? "local"] ?? PROVIDERS.local!)();
}

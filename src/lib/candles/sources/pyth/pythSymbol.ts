import type { Asset } from "@alea/types/assets";

export function pythSymbol({ asset }: { readonly asset: Asset }): string {
  return `Crypto.${asset.toUpperCase()}/USD`;
}

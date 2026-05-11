import "@alea/lib/filters/all";

import { allCandidates } from "@alea/lib/filters/registry";

export type CandidateRegistryKeyParts = {
  readonly filterId: string;
  readonly filterVersion: number;
  readonly configCanon: string;
};

export function candidateRegistryKey({
  filterId,
  filterVersion,
  configCanon,
}: CandidateRegistryKeyParts): string {
  return JSON.stringify([filterId, filterVersion, configCanon]);
}

export function activeCandidateRows(): readonly CandidateRegistryKeyParts[] {
  return allCandidates().map((candidate) => ({
    filterId: candidate.filterId,
    filterVersion: candidate.version,
    configCanon: candidate.configCanon,
  }));
}

export function activeCandidateKeys(): ReadonlySet<string> {
  return new Set(activeCandidateRows().map(candidateRegistryKey));
}

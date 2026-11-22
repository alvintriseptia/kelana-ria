import type {
  ClaimRulebookPack,
  GeoSnapshot,
  HideSeekRulebookPack,
  RulebookFormat,
  RulebookValidationIssue,
} from "@kelana-ria/contracts";

export type StudioPack = HideSeekRulebookPack | ClaimRulebookPack;

export type StudioStep = 1 | 2 | 3 | 4;

export type StudioVersionRecord = {
  packId: string;
  version: number;
  format: RulebookFormat;
  isOfficial: boolean;
  status: string;
  pack: StudioPack;
  snapshot: GeoSnapshot;
  reviewNote: string | null;
  pausedReason?: string | null;
};

export type StudioEarningsRecord = {
  earningsEntryId: string;
  orderId: string;
  packId: string;
  version: number;
  title: string;
  grossAmountIdr: number;
  creatorShareIdr: number;
};

export type StudioValidationState = {
  ok: boolean;
  errors: RulebookValidationIssue[];
  warnings?: RulebookValidationIssue[];
};

export function isClaimStudioPack(pack: StudioPack): pack is ClaimRulebookPack {
  return pack.meta.format === "claim-the-city";
}

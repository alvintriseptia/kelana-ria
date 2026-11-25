import React from "react";
import { Composition, Folder, Still } from "remotion";
import { CampaignThumbnail } from "./components/CampaignThumbnail";
import {
  CAMPAIGN_FPS,
  CAMPAIGN_HEIGHT,
  CAMPAIGN_WIDTH,
  ROUGHCUT_TIMELINE,
} from "./config/timeline";
import {
  S07_SH02_LOCKED_EXCERPT,
  S07_SH02_V2_CUES,
} from "./config/motionPrototypeS07SH02";
import { KelanaRiaRoughCut } from "./compositions/KelanaRiaRoughCut";
import { MotionDesignTestS07SH02 } from "./compositions/MotionDesignTestS07SH02";

export const RemotionRoot: React.FC = () => {
  return (
    <Folder name="Claim-the-City">
      <Composition
        id="KelanaRia-RoughCut"
        component={KelanaRiaRoughCut}
        durationInFrames={ROUGHCUT_TIMELINE.totalDurationInFrames}
        fps={CAMPAIGN_FPS}
        width={CAMPAIGN_WIDTH}
        height={CAMPAIGN_HEIGHT}
        defaultProps={{
          showPlaceholders: false,
          showDevShotSlate: false,
          useMasterAudioMix: true,
        }}
      />

      <Composition
        id="KR-MotionDesign-Test-S07-SH02"
        component={MotionDesignTestS07SH02}
        durationInFrames={S07_SH02_V2_CUES.totalFrames}
        fps={CAMPAIGN_FPS}
        width={CAMPAIGN_WIDTH}
        height={CAMPAIGN_HEIGHT}
        defaultProps={{
          footageVolume: S07_SH02_LOCKED_EXCERPT.volume,
        }}
      />

      <Still
        id="KR-ClaimTheCity-Thumbnail"
        component={CampaignThumbnail}
        width={CAMPAIGN_WIDTH}
        height={CAMPAIGN_HEIGHT}
      />
    </Folder>
  );
};

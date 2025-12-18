import { Action, ActionPanel, Clipboard, Detail } from "@raycast/api";
import { useEffect, useMemo, useState } from "react";

import { pickTwoPixelsWithResult } from "./picker";
import { TagColors } from "./tagColors";
import { getApcaScaleColorKey, getApcaScaleWord } from "./apcaScale";
import { clearRememberedPick, loadRememberedPick, saveRememberedPick } from "./rememberedPick";
import { useColorParsing } from "./useColorParsing";
import { useContrastResults } from "./useContrastResults";
import { useSwatchMarkdown } from "./useSwatchMarkdown";
import type { TagItem } from "./types";

export default function Command() {
  const [foregroundHex, setForegroundHex] = useState("");
  const [backgroundHex, setBackgroundHex] = useState("");
  const [isPicking, setIsPicking] = useState(false);

  const foreground = useColorParsing(foregroundHex);
  const background = useColorParsing(backgroundHex);
  const results = useContrastResults(foreground, background);

  const detailMarkdown = useSwatchMarkdown(foreground, background);

  useEffect(() => {
    let canceled = false;

    const run = async (): Promise<void> => {
      const remembered = await loadRememberedPick();
      if (canceled) {
        return;
      }

      if (remembered) {
        setForegroundHex(remembered.foreground.hex);
        setBackgroundHex(remembered.background.hex);
        return;
      }

      const picked = await pickTwoPixelsWithResult({
        setIsPicking,
        setForegroundHex,
        setBackgroundHex,
      });

      if (canceled) {
        return;
      }

      if (picked) {
        await saveRememberedPick(picked);
      }
    };

    void run();

    return () => {
      canceled = true;
    };
  }, []);

  const wcagSummary = useMemo(() => {
    if (!results) {
      return null;
    }

    const ratio = results.wcagRatio;
    return {
      ratio,
      aaNormal: ratio >= 4.5,
      aaaNormal: ratio >= 7.0,
      aaLarge: ratio >= 3.0,
      aaaLarge: ratio >= 4.5,
    };
  }, [results]);

  const apcaSummary = useMemo(() => {
    if (!results) {
      return null;
    }

    const lc = results.apca;
    const absLc = Math.abs(lc);

    return {
      lc,
      absLc,
    };
  }, [results]);

  const wcagTagItems = useMemo((): TagItem[] | null => {
    if (!wcagSummary) {
      return null;
    }

    const normalText = wcagSummary.aaaNormal ? "AAA normal" : "AA normal";
    const normalPass = wcagSummary.aaaNormal || wcagSummary.aaNormal;

    const largeText = wcagSummary.aaaLarge ? "AAA large" : "AA large";
    const largePass = wcagSummary.aaaLarge || wcagSummary.aaLarge;

    return [
      {
        key: "normal",
        text: normalText,
        color: normalPass ? TagColors.pass : TagColors.fail,
      },
      {
        key: "large",
        text: largeText,
        color: largePass ? TagColors.pass : TagColors.fail,
      },
    ];
  }, [wcagSummary]);

  const apcaColor = useMemo(() => {
    if (!apcaSummary) {
      return undefined;
    }

    const key = getApcaScaleColorKey(apcaSummary.absLc);
    return TagColors.apca[key];
  }, [apcaSummary]);

  const apcaWord = useMemo((): string | null => {
    if (!apcaSummary) {
      return null;
    }

    return getApcaScaleWord(apcaSummary.absLc);
  }, [apcaSummary]);

  const apcaTagItems = useMemo((): TagItem[] => {
    if (!apcaSummary) {
      return [
        {
          key: "apcaAbsLc",
          text: "—",
        },
      ];
    }

    return [
      {
        key: "apcaAbsLc",
        text: apcaWord ?? "—",
        color: apcaColor,
      },
    ];
  }, [apcaSummary, apcaWord, apcaColor]);

  return (
    <Detail
      markdown={detailMarkdown}
      actions={
        <ActionPanel>
          <ActionPanel.Section>
            <Action
              title={isPicking ? "Picking…" : "Pick Two Pixels"}
              onAction={async () => {
                const picked = await pickTwoPixelsWithResult({
                  setIsPicking,
                  setForegroundHex,
                  setBackgroundHex,
                });

                if (picked) {
                  await saveRememberedPick(picked);
                }
              }}
            />
          </ActionPanel.Section>

          <ActionPanel.Section>
            <Action
              title="Copy Foreground Color"
              onAction={async () => {
                if (!foreground) {
                  return;
                }

                await Clipboard.copy(foreground.hex.replace(/^#/, ""));
              }}
            />
            <Action
              title="Copy Background Color"
              onAction={async () => {
                if (!background) {
                  return;
                }

                await Clipboard.copy(background.hex.replace(/^#/, ""));
              }}
            />
          </ActionPanel.Section>

          <ActionPanel.Section>
            <Action
              title="Swap Foreground and Background"
              onAction={() => {
                if (!foregroundHex.trim() || !backgroundHex.trim()) {
                  return;
                }

                const fg = foregroundHex;
                setForegroundHex(backgroundHex);
                setBackgroundHex(fg);
              }}
            />
            <Action
              title="Clear"
              onAction={async () => {
                setForegroundHex("");
                setBackgroundHex("");
                await clearRememberedPick();
              }}
            />
          </ActionPanel.Section>
        </ActionPanel>
      }
      metadata={
        <Detail.Metadata>
          {wcagSummary && (
            <>
              <Detail.Metadata.Label title="WCAG" text={`${Math.round(wcagSummary.ratio * 100) / 100}`} />
              <Detail.Metadata.TagList title="">
                {wcagTagItems?.map((item) => {
                  return <Detail.Metadata.TagList.Item key={item.key} text={item.text} color={item.color} />;
                })}
              </Detail.Metadata.TagList>
              <Detail.Metadata.Separator />
            </>
          )}

          {apcaSummary && (
            <>
              <Detail.Metadata.Label
                title="APCA"
                text={apcaSummary ? String(Math.abs(Math.round(apcaSummary.lc))) : "—"}
              />
              <Detail.Metadata.TagList title="">
                {apcaTagItems.map((item) => {
                  return <Detail.Metadata.TagList.Item key={item.key} text={item.text} color={item.color} />;
                })}
              </Detail.Metadata.TagList>
              <Detail.Metadata.Separator />
            </>
          )}
        </Detail.Metadata>
      }
    />
  );
}

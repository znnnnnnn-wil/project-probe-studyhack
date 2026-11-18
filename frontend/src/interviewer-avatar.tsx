import React, { useEffect, useRef, useState } from "react";
import { animateInterviewer, type AvatarState } from "./interviewer-motion";
import type { FacePresence } from "./use-face-presence";
import "./interviewer.css";

const PORTRAIT_URL = "/models/interviewer-portrait.webp";

export function InterviewerAvatar({
  state = "idle",
  label = "虚拟面试官陈老师",
  mouthLevel,
  presence,
}: {
  state?: AvatarState;
  label?: string;
  mouthLevel?: { current: number };
  presence?: { current: FacePresence };
}) {
  const image = useRef<HTMLImageElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef({ state, mouthLevel, presence });
  latest.current = { state, mouthLevel, presence };
  const [animated, setAnimated] = useState(false);

  useEffect(() => {
    const portrait = image.current;
    const surface = canvas.current;
    if (!portrait || !surface) return;
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    let active = true;
    let stop: (() => void) | undefined;

    const renderPortrait = () => {
      stop?.();
      stop = undefined;
      setAnimated(false);
      if (preference.matches || !portrait.naturalWidth) return;
      stop = animateInterviewer(surface, portrait, () => {
        const input = latest.current;
        return {
          state: input.state,
          mouthLevel: input.mouthLevel?.current ?? -1,
          presence: input.presence?.current,
        };
      }, () => {
        if (active) setAnimated(true);
      });
    };
    const useStaticPortrait = () => {
      stop?.();
      stop = undefined;
      setAnimated(false);
    };

    portrait.addEventListener("load", renderPortrait);
    surface.addEventListener("webglcontextlost", useStaticPortrait);
    preference.addEventListener("change", renderPortrait);
    if (portrait.complete) renderPortrait();
    return () => {
      active = false;
      stop?.();
      portrait.removeEventListener("load", renderPortrait);
      surface.removeEventListener("webglcontextlost", useStaticPortrait);
      preference.removeEventListener("change", renderPortrait);
    };
  }, []);

  return (
    <div className="avatar-shell" role="img" aria-label={label}>
      <img ref={image} className="avatar-portrait" src={PORTRAIT_URL} alt="" />
      <canvas
        ref={canvas}
        className={animated ? "avatar-motion is-ready" : "avatar-motion"}
        aria-hidden="true"
      />
    </div>
  );
}

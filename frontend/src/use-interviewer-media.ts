import { useCallback, useEffect, useRef, useState } from "react";

export type SpeechTarget = { projectId: string; turnId: string };

export function useQuestionSpeech(ttsEnabled = false) {
  const [speaking, setSpeaking] = useState(false);
  // -1 表示当前没有云端音频分析，口型退回程序化动画。
  const mouthLevel = useRef(-1);
  const speechId = useRef(0);
  const audioContext = useRef<AudioContext | null>(null);
  const release = useRef<(() => void) | null>(null);
  const browserSupported =
    typeof window !== "undefined" && "speechSynthesis" in window;
  const supported = ttsEnabled || browserSupported;
  const stop = useCallback(() => {
    speechId.current++;
    release.current?.();
    release.current = null;
    mouthLevel.current = -1;
    if (browserSupported) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [browserSupported]);
  const browserSpeak = useCallback(
    (text: string, id: number) => {
      if (!browserSupported) return;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "zh-CN";
      utterance.rate = 0.94;
      const voices = window.speechSynthesis.getVoices();
      const preferred =
        voices.find(
          (voice) =>
            voice.lang.startsWith("zh") &&
            /Yunxi|Yunyang|Male|云希|云扬/.test(voice.name),
        ) || voices.find((voice) => voice.lang.startsWith("zh"));
      if (preferred) utterance.voice = preferred;
      utterance.onstart = () => {
        if (id === speechId.current) setSpeaking(true);
      };
      const finished = () => {
        if (id === speechId.current) setSpeaking(false);
      };
      utterance.onend = finished;
      utterance.onerror = finished;
      window.speechSynthesis.speak(utterance);
    },
    [browserSupported],
  );
  const cloudSpeak = useCallback(
    async (text: string, target: SpeechTarget, id: number) => {
      const controller = new AbortController();
      const audio = new Audio();
      let objectUrl = "";
      let source: MediaElementAudioSourceNode | null = null;
      let frame = 0;
      const cleanup = () => {
        controller.abort();
        cancelAnimationFrame(frame);
        audio.pause();
        audio.removeAttribute("src");
        try {
          audio.load();
        } catch {}
        source?.disconnect();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        mouthLevel.current = -1;
      };
      release.current = cleanup;
      try {
        const response = await fetch(
          `/api/projects/${target.projectId}/practice/tts`,
          {
            method: "POST",
            credentials: "same-origin",
            signal: controller.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ turnId: target.turnId }),
          },
        );
        if (!response.ok || !response.body) throw new Error("tts unavailable");
        if (id !== speechId.current) return;
        if (
          typeof MediaSource === "undefined" ||
          !MediaSource.isTypeSupported("audio/mpeg")
        )
          throw new Error("streaming unsupported");
        const mediaSource = new MediaSource();
        objectUrl = URL.createObjectURL(mediaSource);
        audio.src = objectUrl;
        await new Promise<void>((resolve, reject) => {
          mediaSource.addEventListener("sourceopen", () => resolve(), {
            once: true,
          });
          audio.addEventListener("error", () => reject(new Error("audio")), {
            once: true,
          });
        });
        if (id !== speechId.current) return;
        const buffer = mediaSource.addSourceBuffer("audio/mpeg");
        const chunks: Uint8Array<ArrayBuffer>[] = [];
        let appending = false;
        let streamDone = false;
        const pump = () => {
          if (appending || buffer.updating) return;
          const next = chunks.shift();
          if (next) {
            appending = true;
            buffer.appendBuffer(next);
          } else if (streamDone && mediaSource.readyState === "open") {
            try {
              mediaSource.endOfStream();
            } catch {}
          }
        };
        buffer.addEventListener("updateend", () => {
          appending = false;
          pump();
        });
        const Context =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        const context =
          audioContext.current ?? (audioContext.current = new Context());
        await context.resume();
        if (id !== speechId.current) return;
        source = context.createMediaElementSource(audio);
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        analyser.connect(context.destination);
        const samples = new Uint8Array(analyser.fftSize);
        const tick = () => {
          frame = requestAnimationFrame(tick);
          analyser.getByteTimeDomainData(samples);
          let sum = 0;
          for (let i = 0; i < samples.length; i++) {
            const value = (samples[i] - 128) / 128;
            sum += value * value;
          }
          const level = Math.min(1, Math.sqrt(sum / samples.length) * 5);
          mouthLevel.current += (level - mouthLevel.current) * 0.45;
        };
        mouthLevel.current = 0;
        audio.addEventListener(
          "playing",
          () => {
            if (id !== speechId.current) return;
            setSpeaking(true);
            tick();
          },
          { once: true },
        );
        const finished = () => {
          if (id !== speechId.current) return;
          cancelAnimationFrame(frame);
          mouthLevel.current = -1;
          setSpeaking(false);
        };
        audio.addEventListener("ended", finished, { once: true });
        audio.addEventListener("error", finished, { once: true });
        const reader = response.body.getReader();
        void (async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (id !== speechId.current) return;
              if (done) break;
              chunks.push(value as Uint8Array<ArrayBuffer>);
              pump();
            }
          } catch {
            // 流中断时播放已收到的部分，不再回退重播。
          }
          streamDone = true;
          pump();
        })();
        await audio.play();
      } catch (cause) {
        cleanup();
        release.current = null;
        if (
          id === speechId.current &&
          !(cause instanceof DOMException && cause.name === "AbortError")
        )
          browserSpeak(text, id);
      }
    },
    [browserSpeak],
  );
  const speak = useCallback(
    (text: string, target?: SpeechTarget) => {
      stop();
      if (!text.trim()) return;
      const id = speechId.current;
      if (ttsEnabled && target) void cloudSpeak(text, target, id);
      else browserSpeak(text, id);
    },
    [stop, ttsEnabled, cloudSpeak, browserSpeak],
  );
  useEffect(
    () => () => {
      stop();
      void audioContext.current?.close();
      audioContext.current = null;
    },
    [stop],
  );
  return { speaking, speak, stop, supported, mouthLevel };
}

export function useCameraPreview() {
  const [on, setOn] = useState(false);
  const [error, setError] = useState("");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  const streamRef = useRef<MediaStream | null>(null);
  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (mounted.current) {
      setStream(null);
      setOn(false);
    }
  }, []);
  const toggle = useCallback(async () => {
    if (pending.current) return;
    if (streamRef.current) {
      stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("当前浏览器无法打开摄像头，可继续语音或文字训练");
      return;
    }
    pending.current = true;
    setError("");
    try {
      const next = await navigator.mediaDevices.getUserMedia({
        video: { width: 480, height: 320, facingMode: "user" },
        audio: false,
      });
      if (!mounted.current) {
        next.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = next;
      setStream(next);
      setOn(true);
    } catch {
      if (mounted.current)
        setError("摄像头未开启，可以继续使用语音或文字训练");
    } finally {
      pending.current = false;
    }
  }, [stop]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stop();
    };
  }, [stop]);
  return { on, error, stream, toggle, stop };
}
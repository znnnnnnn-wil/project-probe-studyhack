import { useCallback, useEffect, useRef, useState } from "react";

export function useQuestionSpeech() {
  const [speaking, setSpeaking] = useState(false);
  const speechId = useRef(0);
  const supported =
    typeof window !== "undefined" && "speechSynthesis" in window;
  const stop = useCallback(() => {
    speechId.current++;
    if (supported) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [supported]);
  const speak = useCallback(
    (text: string) => {
      stop();
      if (!supported || !text.trim()) return;
      const id = speechId.current;
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
    [stop, supported],
  );
  useEffect(() => stop, [stop]);
  return { speaking, speak, stop, supported };
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
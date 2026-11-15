import React, { useEffect, useRef, useState } from "react";
import { Mic, Square, X, LoaderCircle, Plus, AudioLines, Check } from "lucide-react";
import type { VoiceActivity } from "./voice-activity";
import "./experience-voice.css";
interface SpeechResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechResultEventLike {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechResultLike };
}
interface SpeechErrorEventLike {
  error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechResultEventLike) => void) | null;
  onerror: ((event: SpeechErrorEventLike) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;
function recognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
const MAX_SECONDS = 180;

export function ExperienceVoice({
  disabled,
  remaining,
  onAppend,
  onBusy,
}: {
  disabled: boolean;
  remaining: number;
  onAppend: (text: string) => void;
  onBusy?: (busy: boolean) => void;
}) {
  const [supported] = useState(() => recognitionCtor() !== null);
  const [state, setState] = useState<"idle" | "requesting" | "recording">("idle");
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [live, setLive] = useState("");
  const [heard, setHeard] = useState(false);
  const [vadReady, setVadReady] = useState(false);
  const [autoStop, setAutoStop] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [overflow, setOverflow] = useState("");

  const mounted = useRef(true);
  const recording = useRef(false);
  const finalText = useRef("");
  const interimText = useRef("");
  const speechDetected = useRef(false);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const current = useRef({ remaining, onAppend, disabled, autoStop });
  current.current = { remaining, onAppend, disabled, autoStop };
  const busyCallback = useRef(onBusy);
  busyCallback.current = onBusy;
  const resources = useRef<{
    stream?: MediaStream;
    context?: AudioContext;
    node?: AudioWorkletNode;
    timer?: number;
    vad?: VoiceActivity;
  }>({});

  const releaseAudio = () => {
    window.clearInterval(resources.current.timer);
    resources.current.node?.disconnect();
    resources.current.stream?.getTracks().forEach((track) => track.stop());
    void resources.current.vad?.destroy().catch(() => {});
    void resources.current.context?.close().catch(() => {});
    resources.current = {};
  };
  const releaseRecognition = () => {
    const rec = recognition.current;
    recognition.current = null;
    if (rec) {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        rec.abort();
      } catch {
        /* already stopped */
      }
    }
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      recording.current = false;
      releaseAudio();
      releaseRecognition();
      busyCallback.current?.(false);
    };
  }, []);
  useEffect(() => {
    onBusy?.(state !== "idle");
  }, [state, onBusy]);

  const reset = () => {
    finalText.current = "";
    interimText.current = "";
    speechDetected.current = false;
    setLive("");
    setHeard(false);
    setVadReady(false);
    setLevel(0);
    setSeconds(0);
  };

  const finish = (commit: boolean, message = "") => {
    if (!recording.current) return;
    recording.current = false;
    const text = (finalText.current + interimText.current).trim();
    releaseAudio();
    releaseRecognition();
    if (!mounted.current) return;
    setLevel(0);
    setState("idle");
    if (!commit) {
      reset();
      if (message) setError(message);
      return;
    }
    reset();
    if (!text) {
      setNotice("未识别到语音，请靠近麦克风重试");
      return;
    }
    if (text.length > current.current.remaining || current.current.disabled) {
      setOverflow(text);
      setError("识别文字超出剩余字数，请精简后加入回答");
      return;
    }
    current.current.onAppend(text);
    setNotice("语音已填入回答");
  };

  const start = async () => {
    if (recording.current || resources.current.stream) return;
    const Ctor = recognitionCtor();
    if (!Ctor) {
      setError("当前浏览器不支持语音识别，请使用 Chrome / Edge 或文字回答");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) {
      setError("当前浏览器不支持录音，请改用新版浏览器或文字回答");
      return;
    }
    setError("");
    setNotice("");
    setOverflow("");
    reset();
    setState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      if (!mounted.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      resources.current.stream = stream;
      const context = new AudioContext({ sampleRate: 16000 });
      resources.current.context = context;
      await context.audioWorklet.addModule("/voice-recorder.js");
      if (!mounted.current) {
        releaseAudio();
        return;
      }
      await context.resume();

      // Silero VAD：检测说话开始与静音结束（静音自动停止）。
      try {
        const creation = import("./voice-activity").then(({ VoiceActivity }) =>
          VoiceActivity.create(
            context.sampleRate,
            () => {
              speechDetected.current = true;
              if (mounted.current && recording.current) setHeard(true);
            },
            () => {
              if (recording.current && current.current.autoStop) finish(true);
            },
            () => {
              if (!mounted.current || !recording.current) return;
              const failed = resources.current.vad;
              resources.current.vad = undefined;
              void failed?.destroy().catch(() => {});
              setVadReady(false);
              setNotice("静音检测暂不可用，可手动结束录音");
            },
          ),
        );
        let abandoned = false;
        let timeout: number | undefined;
        const guarded = creation.then((vad) => {
          if (abandoned) {
            void vad.destroy().catch(() => {});
            throw new Error("VAD loading expired");
          }
          return vad;
        });
        let vad: VoiceActivity;
        try {
          vad = await Promise.race([
            guarded,
            new Promise<never>((_, reject) => {
              timeout = window.setTimeout(() => {
                abandoned = true;
                reject(new Error("VAD loading timed out"));
              }, 15000);
            }),
          ]);
        } finally {
          window.clearTimeout(timeout);
        }
        if (!mounted.current) {
          await vad.destroy();
          releaseAudio();
          return;
        }
        resources.current.vad = vad;
        setVadReady(true);
      } catch {
        if (!mounted.current) {
          releaseAudio();
          return;
        }
        setVadReady(false);
        setNotice("静音检测加载失败，可手动结束录音");
      }

      const node = new AudioWorkletNode(context, "voice-recorder");
      resources.current.node = node;
      node.port.onmessage = (event) => {
        if (!recording.current) return;
        const chunk = event.data as Float32Array;
        const rms = Math.sqrt(
          chunk.reduce((sum, value) => sum + value * value, 0) / chunk.length,
        );
        setLevel(Math.min(100, rms * 400));
        resources.current.vad?.feed(chunk);
      };
      context.createMediaStreamSource(stream).connect(node);
      const mute = context.createGain();
      mute.gain.value = 0;
      node.connect(mute).connect(context.destination);

      // Web Speech API：实时转写为中文文本。
      const rec = new Ctor();
      recognition.current = rec;
      rec.lang = "zh-CN";
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.onresult = (event) => {
        if (!recording.current) return;
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) finalText.current += result[0].transcript;
          else interim += result[0].transcript;
        }
        interimText.current = interim;
        setLive((finalText.current + interim).trim());
      };
      rec.onerror = (event) => {
        if (!recording.current) return;
        if (event.error === "aborted") return;
        const message =
          event.error === "no-speech"
            ? "未检测到语音，请靠近麦克风重试"
            : event.error === "not-allowed" || event.error === "service-not-allowed"
              ? "麦克风或语音服务权限未允许，请在浏览器中允许后重试"
              : event.error === "audio-capture"
                ? "无法访问麦克风，请检查设备后重试"
                : event.error === "network"
                  ? "语音识别网络异常，请检查网络后重试"
                  : "语音识别中断，请重试";
        finish(false, message);
      };
      rec.onend = () => {
        // 识别引擎自身结束（含静音）时，提交已识别文字。
        if (recording.current) finish(true);
      };

      recording.current = true;
      try {
        rec.start();
      } catch {
        finish(false, "无法启动语音识别，请重试");
        return;
      }
      const started = performance.now();
      resources.current.timer = window.setInterval(() => {
        const elapsed = (performance.now() - started) / 1000;
        setSeconds(Math.floor(elapsed));
        if (resources.current.vad && !speechDetected.current && elapsed >= 10) {
          finish(false, "未检测到语音，请检查麦克风后重新录音");
          return;
        }
        if (elapsed >= MAX_SECONDS) finish(true);
      }, 250);
      setSeconds(0);
      setState("recording");
    } catch (cause) {
      releaseAudio();
      releaseRecognition();
      if (!mounted.current) return;
      recording.current = false;
      setError(
        cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "麦克风权限未允许，请在浏览器中允许后重试"
          : "无法启动麦克风，请检查设备后重试",
      );
      setState("idle");
    }
  };

  const addOverflow = () => {
    const text = overflow.trim().slice(0, Math.max(0, current.current.remaining));
    if (!text) return;
    current.current.onAppend(text);
    setOverflow("");
    setError("");
    setNotice("语音已填入回答");
  };

  const active = state !== "idle";
  const canStart = supported && !disabled && remaining > 0 && !active;
  const minutes = Math.floor(seconds / 60);
  const secs = String(seconds % 60).padStart(2, "0");

  return (
    <div className={"exp-voice" + (state === "recording" ? " is-live" : "")}>
      <div className="exp-voice-bar">
        <span className="exp-voice-title">
          <AudioLines size={16} aria-hidden="true" />
          语音输入
          <small>说话自动转文字 · 静音自动结束</small>
        </span>
        {state === "idle" && (
          <button
            type="button"
            className="exp-voice-mic"
            onClick={() => void start()}
            disabled={!canStart}
            title={
              !supported
                ? "当前浏览器不支持语音识别"
                : remaining <= 0
                  ? "回答字数已满"
                  : "开始语音输入"
            }
            aria-label="开始语音输入"
          >
            <Mic size={16} aria-hidden="true" />
            开始说话
          </button>
        )}
        {state === "requesting" && (
          <span className="exp-voice-connecting" role="status">
            <LoaderCircle className="spin" size={16} aria-hidden="true" />
            正在连接麦克风
          </span>
        )}
        {state === "recording" && (
          <span className="exp-voice-live-tag" role="status">
            <span className="exp-voice-dot" aria-hidden="true" />
            录音中
          </span>
        )}
      </div>

      {state === "recording" && (
        <div className="exp-voice-panel">
          <div className="exp-voice-meter-row">
            <span className="exp-voice-time">
              {minutes}:{secs} / 3:00
            </span>
            <div className="exp-voice-meter" aria-hidden="true">
              <span style={{ width: level + "%" }} />
            </div>
            <span className={"exp-voice-vad" + (heard ? " is-heard" : "")}>
              {vadReady
                ? heard
                  ? "正在聆听，停顿后自动结束"
                  : "等待说话…"
                : "手动结束录音"}
            </span>
          </div>
          <div className="exp-voice-transcript" aria-live="polite">
            {live ? (
              <p>{live}</p>
            ) : (
              <p className="exp-voice-placeholder">
                开始说话，识别文字会实时显示在这里…
              </p>
            )}
          </div>
          <div className="exp-voice-controls">
            <label className="exp-voice-toggle">
              <input
                type="checkbox"
                checked={autoStop}
                onChange={(e) => setAutoStop(e.target.checked)}
              />
              静音自动结束
            </label>
            <div className="exp-voice-buttons">
              <button
                type="button"
                className="exp-voice-cancel"
                onClick={() => finish(false)}
                aria-label="取消录音"
              >
                <X size={16} aria-hidden="true" />
                取消
              </button>
              <button
                type="button"
                className="exp-voice-stop"
                onClick={() => finish(true)}
                aria-label="结束并填入回答"
              >
                <Square size={14} aria-hidden="true" />
                结束并填入
              </button>
            </div>
          </div>
        </div>
      )}

      {overflow && (
        <div className="exp-voice-overflow">
          <label>
            识别结果（超出剩余字数，可精简）
            <textarea
              aria-label="语音识别结果"
              rows={4}
              maxLength={6000}
              value={overflow}
              onChange={(e) => setOverflow(e.target.value)}
            />
          </label>
          <div className="exp-voice-overflow-actions">
            <small>
              {overflow.trim().length} 字 · 剩余 {Math.max(0, remaining)} 字
            </small>
            <button
              type="button"
              className="button secondary"
              disabled={disabled || !overflow.trim() || overflow.trim().length > remaining}
              onClick={addOverflow}
            >
              <Plus size={16} aria-hidden="true" />
              加入回答
            </button>
          </div>
        </div>
      )}

      {notice && !error && (
        <p className="exp-voice-notice" role="status">
          <Check size={14} aria-hidden="true" />
          {notice}
        </p>
      )}
      {!supported && (
        <p className="exp-voice-notice is-muted">
          当前浏览器不支持语音识别，请使用 Chrome / Edge，或直接文字回答。
        </p>
      )}
      {error && (
        <p className="exp-voice-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
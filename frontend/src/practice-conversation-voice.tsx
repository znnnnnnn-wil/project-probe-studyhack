import React, { useEffect, useRef, useState } from "react";
import { AudioLines } from "lucide-react";
import { ApiError, upload } from "./api";
import { encodeWav } from "./voice-input";
import type { VoiceActivity } from "./voice-activity";

type Phase = "connecting" | "waiting" | "listening" | "transcribing" | "turn-taking";

type VoiceTarget = {
  turnId: string;
  exchangeCount: number;
};

type PracticeConversationVoiceProps = VoiceTarget & {
  projectId: string;
  enabled: boolean;
  suspended: boolean;
  onUtterance: (text: string) => Promise<void> | void;
  onListening?: (listening: boolean) => void;
  onProcessing?: (processing: boolean) => void;
};

const PHASE_LABELS: Record<Phase, string> = {
  connecting: "正在准备麦克风",
  waiting: "麦克风已开启，可以直接说话",
  listening: "正在听你说话",
  transcribing: "正在转写这段回答",
  "turn-taking": "轮到你时，麦克风会自动恢复",
};
const AUDIO_RATE = 16000;
const AUDIO_LIMIT = AUDIO_RATE * 180;

function sameTarget(left: VoiceTarget, right: VoiceTarget) {
  return left.turnId === right.turnId && left.exchangeCount === right.exchangeCount;
}

export function PracticeConversationVoice(props: PracticeConversationVoiceProps) {
  const { projectId, turnId, exchangeCount, enabled, suspended } = props;
  const current = useRef(props);
  current.current = props;
  const controls = useRef<{
    sync: () => void;
    pause: () => void;
    retry: () => void;
    discard: () => void;
  } | null>(null);
  const [phase, setPhase] = useState<Phase>("connecting");
  const [paused, setPaused] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState("");
  const [failure, setFailure] = useState<{ message: string; hasAudio: boolean }>();

  useEffect(() => {
    if (!enabled || paused) return;
    let closed = false;
    let stream: MediaStream | undefined;
    let context: AudioContext | undefined;
    let node: AudioWorkletNode | undefined;
    let vad: VoiceActivity | undefined;
    let speechTimer: number | undefined;
    let request: AbortController | undefined;
    let failedAudio: Blob | undefined;
    let blocked = false;
    let sending = false;
    let userPaused = false;
    let armed = false;
    let capturing = false;
    let target: VoiceTarget = {
      turnId: current.current.turnId,
      exchangeCount: current.current.exchangeCount,
    };

    const isAvailable = () => !closed && !userPaused && !document.hidden && current.current.enabled
      && !current.current.suspended && sameTarget(target, current.current);

    const mute = () => {
      if (armed) vad?.pause();
      armed = false;
      capturing = false;
      window.clearTimeout(speechTimer);
      stream?.getAudioTracks().forEach(track => { track.enabled = false; });
      current.current.onListening?.(false);
    };

    const sync = () => {
      if (!sameTarget(target, current.current)) {
        request?.abort();
        target = {
          turnId: current.current.turnId,
          exchangeCount: current.current.exchangeCount,
        };
        mute();
        failedAudio = undefined;
        setNotice("");
        if (vad) {
          blocked = false;
          setFailure(undefined);
        }
      }
      if (!isAvailable()) {
        request?.abort();
        mute();
        setPhase("turn-taking");
        return;
      }
      if (sending || blocked) return;
      if (!vad || !stream) {
        setPhase("connecting");
        return;
      }
      if (armed) return;
      armed = true;
      const activity = vad;
      void activity.resume().then(() => {
        if (!armed || capturing || !isAvailable() || vad !== activity) return;
        capturing = true;
        stream?.getAudioTracks().forEach(track => { track.enabled = true; });
        setPhase("waiting");
      });
    };

    const fail = (message: string, audio?: Blob) => {
      mute();
      failedAudio = audio;
      blocked = true;
      setFailure({ message, hasAudio: !!audio });
    };

    const transcribe = async (audio: Blob) => {
      if (!isAvailable() || sending) return;
      const audioTarget = target;
      sending = true;
      blocked = false;
      failedAudio = undefined;
      setFailure(undefined);
      setNotice("");
      mute();
      setPhase("transcribing");
      current.current.onProcessing?.(true);
      const controller = new AbortController();
      request = controller;
      try {
        const result = await upload<{ text: string }>(
          "/projects/" + projectId + "/practice/transcribe",
          audio,
          "answer.wav",
          { turnId: audioTarget.turnId, exchangeCount: String(audioTarget.exchangeCount) },
          controller.signal,
        );
        if (!isAvailable() || target !== audioTarget || controller.signal.aborted) return;
        const text = result.text?.trim();
        if (!text) {
          setNotice("这段话没有转写出文字，可以再说一次。");
          return;
        }
        request = undefined;
        setPhase("turn-taking");
        await current.current.onUtterance(text);
      } catch (cause) {
        if (!isAvailable() || target !== audioTarget || controller.signal.aborted) return;
        if (cause instanceof ApiError && cause.status === 422) {
          setNotice(cause.message);
        } else if (cause instanceof ApiError && cause.status === 409) {
          setNotice("题目状态已更新，请在当前题继续。");
        } else {
          fail(
            cause instanceof Error ? cause.message : "语音转写失败，可用刚才的录音重试。",
            request ? audio : undefined,
          );
        }
      } finally {
        request = undefined;
        sending = false;
        if (!closed) {
          current.current.onProcessing?.(false);
          sync();
        }
      }
    };

    const open = async () => {
      setFailure(undefined);
      setNotice("");
      setPhase("connecting");
      if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) {
        fail("当前浏览器无法进行自动语音面试，可以用文字继续。");
        return;
      }
      try {
        const input = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
          video: false,
        });
        if (closed) {
          input.getTracks().forEach(track => track.stop());
          return;
        }
        stream = input;
        if (!input.getAudioTracks().length) throw new Error("Missing microphone track");
        mute();
        const audio = new AudioContext({ sampleRate: AUDIO_RATE });
        context = audio;
        await audio.audioWorklet.addModule("/voice-recorder.js");
        if (closed) return;
        await audio.resume();
        if (closed) return;
        const { VoiceActivity } = await import("./voice-activity");
        if (closed) return;
        const activity = await VoiceActivity.create(
          audio.sampleRate,
          () => {
            if (!capturing || !isAvailable()) return;
            setNotice("");
            setPhase("listening");
            current.current.onListening?.(true);
            // The practice endpoint accepts up to 180 seconds per segment.
            window.clearTimeout(speechTimer);
            speechTimer = window.setTimeout(() => void vad?.endSegment(), 175_000);
          },
          samples => {
            if (!capturing || !isAvailable()) return;
            if (samples.length < AUDIO_RATE * 0.5) {
              mute();
              sync();
              return;
            }
            void transcribe(encodeWav([samples.subarray(0, AUDIO_LIMIT)], AUDIO_RATE));
          },
          () => {
            if (!closed) fail("自动静音检测中断，可以重试麦克风或用文字回答。");
          },
          { redemptionMs: 1500, minSpeechMs: 320 },
        );
        if (closed) {
          await activity.destroy();
          return;
        }
        vad = activity;
        node = new AudioWorkletNode(audio, "voice-recorder");
        node.port.onmessage = (event: MessageEvent<Float32Array>) => {
          if (capturing && isAvailable()) activity.feed(event.data);
        };
        const silent = audio.createGain();
        silent.gain.value = 0;
        audio.createMediaStreamSource(input).connect(node).connect(silent).connect(audio.destination);
        sync();
      } catch (cause) {
        stream?.getTracks().forEach(track => track.stop());
        void context?.close().catch(() => {});
        if (!closed) fail(cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "请允许浏览器使用麦克风，再重试。"
          : "无法启动麦克风或静音检测，可以重试或用文字回答。");
      }
    };

    controls.current = {
      sync,
      pause: () => {
        userPaused = true;
        request?.abort();
        mute();
      },
      retry: () => {
        if (failedAudio) void transcribe(failedAudio);
        else setAttempt(value => value + 1);
      },
      discard: () => {
        failedAudio = undefined;
        blocked = false;
        setFailure(undefined);
        sync();
      },
    };
    document.addEventListener("visibilitychange", sync);
    void open();
    return () => {
      closed = true;
      document.removeEventListener("visibilitychange", sync);
      controls.current = null;
      request?.abort();
      mute();
      stream?.getTracks().forEach(track => track.stop());
      node?.disconnect();
      void vad?.destroy().catch(() => {});
      void context?.close().catch(() => {});
      current.current.onProcessing?.(false);
    };
  }, [attempt, enabled, paused, projectId]);

  useEffect(() => {
    controls.current?.sync();
  }, [exchangeCount, suspended, turnId]);

  if (!enabled) return null;
  const label = paused ? "麦克风已暂停" : failure ? "语音面试已暂停" : PHASE_LABELS[phase];
  return (
    <div className="exp-voice practice-conversation-voice">
      <div className="exp-voice-bar">
        <span className="exp-voice-title">
          <AudioLines size={16} aria-hidden="true" />
          <span role="status">{label}</span>
        </span>
        <button type="button" className="button secondary" onClick={() => {
          if (!paused) controls.current?.pause();
          setPaused(!paused);
        }}>
          {paused ? "继续语音面试" : "暂停语音面试"}
        </button>
      </div>
      {!paused && notice && <p className="exp-voice-notice" role="status">{notice}</p>}
      {!paused && failure && (
        <>
          <p className="exp-voice-error" role="alert">{failure.message}</p>
          <div className="exp-voice-bar">
            <button type="button" className="button secondary" disabled={suspended}
              onClick={() => controls.current?.retry()}>
              {failure.hasAudio ? "重试转写刚才的录音" : "重试麦克风"}
            </button>
            {failure.hasAudio && <button type="button" className="button secondary"
              onClick={() => controls.current?.discard()}>丢弃录音，继续说话</button>}
          </div>
        </>
      )}
    </div>
  );
}

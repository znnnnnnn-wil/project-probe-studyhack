import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import type { Report, Turn } from "./types";
export type Retest = {
  findingIndex: number;
  turnId: string;
  answer: string;
  status: "GENERATING" | "FAILED" | "COMPLETED";
  report?: Report;
};
type PracticeTurn = Turn & { exchanges?: { answer: string; reply: string }[] };
export type Practice = {
  status: string;
  roundId?: string;
  roundNumber?: number;
  turns?: PracticeTurn[];
  report?: Report;
  modelMode?: string;
  leaseUntil?: number;
  maxTurns?: number;
  interviewTopic?: string;
  retest?: Retest;
  pendingExchange?: { turnId: string; answer: string; exchangeCount: number };
};
export function useProjectPractice(projectId: string, roundId?: string) {
  const [value, setValue] = useState<Practice>({ status: "LOADING" });
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const mounted = useRef(false);
  const sequence = useRef(0);
  const working = useRef(false);
  const reading = useRef(false);
  const current = useRef(answer); current.current = answer;
  const acceptedTurn = useRef("");
  const acceptedRound = useRef("");
  const endpoint = `/projects/${projectId}/practice`;
  const readEndpoint = roundId ? endpoint + "?roundId=" + encodeURIComponent(roundId) : endpoint;
  const key = "practice-draft:" + projectId;
  const turnKey = "practice-draft-turn:" + projectId;
  const exchangeKey = "practice-draft-exchange:" + projectId;
  const clearDraft = useCallback(() => {
    current.current = "";
    setAnswer("");
    sessionStorage.removeItem(key);
    sessionStorage.removeItem(turnKey);
    sessionStorage.removeItem(exchangeKey);
  }, [exchangeKey, key, turnKey]);
  const accept = useCallback((next: Practice) => {
    setValue(next); setError(""); setLoadError(false);
    if (roundId) return;
    const turn = next.turns?.at(-1);
    const submitted = turn?.answer;
    const draftTurn = sessionStorage.getItem(turnKey);
    const draftExchange = sessionStorage.getItem(exchangeKey);
    const changed = (!!acceptedTurn.current && acceptedTurn.current !== turn?.id) || (!!draftTurn && !!turn && draftTurn !== turn.id);
    const roundChanged = !!acceptedRound.current && acceptedRound.current !== next.roundId;
    acceptedTurn.current = turn?.id || "";
    acceptedRound.current = next.roundId || "";
    if (next.report || roundChanged) {
      clearDraft();
      setNotice("");
    } else if (submitted) {
      clearDraft();
      setAnswer(submitted);
      setNotice("回答已提交并保存在服务端；恢复生成不会重复提交。");
    } else if (changed) {
      clearDraft();
      setNotice("上一题回答已保存，请继续当前追问。");
    } else if (draftTurn === turn?.id && draftExchange !== null && current.current.trim() && (
      (next.pendingExchange?.exchangeCount === Number(draftExchange) &&
        next.pendingExchange.answer === current.current.trim()) ||
      turn?.exchanges?.[Number(draftExchange)]?.answer === current.current.trim()
    )) {
      clearDraft();
      setNotice("");
    }
  }, [clearDraft, exchangeKey, roundId, turnKey]);
  const acceptRetest = useCallback((next: Practice) => {
    const currentRound = roundId || acceptedRound.current;
    if (mounted.current && (!currentRound || next.roundId === currentRound)) accept(next);
  }, [accept, roundId]);
  const load = useCallback(async () => {
    if (working.current || reading.current) return;
    reading.current = true;
    const version = ++sequence.current;
    try {
      const next = await api<Practice>(readEndpoint);
      if (mounted.current && version === sequence.current) accept(next);
    } catch (e) {
      if (mounted.current && version === sequence.current) {
        setLoadError(true); setError(e instanceof Error ? e.message : "训练状态读取失败");
      }
    } finally { reading.current = false; }
  }, [readEndpoint, accept]);
  useEffect(() => {
    mounted.current = true;
    const saved = roundId ? "" : sessionStorage.getItem(key)?.slice(0, 6000) || "";
    if (saved) { setAnswer(saved); current.current = saved; setNotice("已恢复此标签页的回答草稿。"); }
    void load();
    return () => { mounted.current = false; ++sequence.current; };
  }, [key, load, roundId]);
  const generating = value.status === "GENERATING" || value.retest?.status === "GENERATING";
  useEffect(() => {
    if (!generating) return;
    const timer = window.setInterval(() => void load(), 2500);
    return () => window.clearInterval(timer);
  }, [generating, load]);
  const submitted = !!value.turns?.at(-1)?.answer;
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (current.current.trim() && !submitted && !value.report) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [submitted, value.report]);
  const edit = (text: string) => {
    current.current = text; setAnswer(text);
    sessionStorage.setItem(key, text);
    const turn = value.turns?.at(-1);
    if (turn) {
      sessionStorage.setItem(turnKey, turn.id);
      sessionStorage.setItem(exchangeKey, String(turn.exchanges?.length ?? 0));
    }
    setNotice("草稿自动保存在当前标签页，提交后才用于AI反馈。");
  };
  const submit = async (utterance?: string, restart = false, topic = "") => {
    if (roundId || working.current || loadError || ["LOADING", "GENERATING"].includes(value.status)) return;
    if (restart && !value.roundId) return;
    const turn = value.turns?.at(-1);
    const text = (utterance ?? current.current).trim();
    const selectedTopic = topic.trim();
    const topicInput = selectedTopic ? { topic: selectedTopic } : {};
    const message = restart ? { ...topicInput, restart: true, roundId: value.roundId } : !submitted && !value.pendingExchange && turn && text
      ? { answer: text, turnId: turn.id, dialogue: true, exchangeCount: turn.exchanges?.length ?? 0 }
      : !value.roundId && !turn ? topicInput : {};
    working.current = true; ++sequence.current; setPending(true); setError("");
    // Keep transcribed text retriable if the reply request fails before it reaches the server.
    if (utterance && "answer" in message && !current.current.trim()) edit(text);
    try {
      const next = await api<Practice>(endpoint, "POST", message);
            if (mounted.current) accept(next);
    } catch (e) {
      if (!mounted.current) return;
      if (e instanceof ApiError && e.status === 409) {
        try {
          const next = await api<Practice>(readEndpoint);
          if (mounted.current) accept(next);
        } catch {
          if (mounted.current) {
            setLoadError(true);
            setError("状态已变化，暂未读到最新进度，请重新读取。");
          }
        }
      } else {
        const message = e instanceof Error ? e.message : "训练请求失败";
        if (e instanceof ApiError && e.status === 503) {
          const state = await api<Practice>(readEndpoint).catch(() => null);
          if (!mounted.current) return;
          if (state?.status === "FAILED") {
            accept(state);
            setError(message);
            return;
          }
        }
        setError(message);
        setValue(previous => ({ ...previous, status: "FAILED" }));
      }
    } finally { working.current = false; if (mounted.current) setPending(false); }
  };
  return { value, answer, edit, error, loadError, pending, notice, submitted, load, submit, acceptRetest };
}

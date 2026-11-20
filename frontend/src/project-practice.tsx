import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "./ui";
import type { Actions } from "./ui";
import { useProjectPractice } from "./use-project-practice";
import { ArrowLeft, ArrowRight, Camera, CameraOff, Check, ChevronDown, ChevronUp, Download, Maximize2, MessageSquare, Mic, RotateCcw, Sparkles, Volume2, VolumeX } from "lucide-react";
import "./project-practice.css";
import { PracticeNext } from "./practice-next";
import { PracticeReview } from "./practice-review";
import type { Project } from "./types";
import { EvidenceReview } from "./evidence-review";
import { PracticeRetest } from "./practice-retest";
import { ExperienceVoice } from "./experience-voice";
import { VoiceInput } from "./voice-input";
import { PracticeConversationVoice } from "./practice-conversation-voice";
import { InterviewerAvatar } from "./interviewer-avatar";
import { useCameraPreview, useQuestionSpeech } from "./use-interviewer-media";
import { useFacePresence } from "./use-face-presence";
import { api, go } from "./api";
import "./experience-report.css";

export function ProjectPractice({ projectId, projectName, roundId, openOnLoad, disabled, onSaved, onEditMaterials, run, busy }: Actions & {
  projectId: string; projectName: string; roundId?: string; openOnLoad?: boolean; disabled: boolean; onSaved: (project: Project) => void; onEditMaterials: () => void;
}) {
  const { value, answer, edit, error, loadError, pending, notice, submitted, load, submit, acceptRetest } = useProjectPractice(projectId, roundId);
  const [expanded, setExpanded] = useState(true);
  const [roomOpen, setRoomOpen] = useState(!!openOnLoad && !roundId);
  const [topic, setTopic] = useState("");
  const roomHadQuestion = useRef(false);
  const [voiceRoom, setVoiceRoom] = useState(false);
  const [voiceReady, setVoiceReady] = useState<{ turnId: string; exchangeCount: number } | null>(null);
  const [practiceSurface] = useState(() => document.createElement("div"));
  const inlineContent = useRef<HTMLDivElement>(null);
  const roomContent = useRef<HTMLDivElement>(null);
  const roomDialog = useRef<HTMLDialogElement>(null);
  const reportHeading = useRef<HTMLHeadingElement>(null);
  const transcript = useRef<HTMLOListElement>(null);
  const spokenPrompt = useRef("");
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [autoListening, setAutoListening] = useState(false);
  const [autoProcessing, setAutoProcessing] = useState(false);
  const [sound, setSound] = useState(true);
  const [mediaConfig, setMediaConfig] = useState<{ ttsEnabled?: boolean; speechEnabled?: boolean }>();
  const [browserVoice, setBrowserVoice] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    api<typeof mediaConfig>("/config", "GET", undefined, controller.signal)
      .then(setMediaConfig)
      .catch(() => { if (!controller.signal.aborted) setMediaConfig({}); });
    return () => controller.abort();
  }, []);
  const { speaking, preparing, speak, stop, unlock, supported: speechSupported, mouthLevel } = useQuestionSpeech(!!mediaConfig?.ttsEnabled);
  const handleVoiceBusy = useCallback((active: boolean) => {
    setVoiceBusy(active);
    if (active) stop();
  }, [stop]);
  const camera = useCameraPreview();
  const { presence, snapshot: face } = useFacePresence(camera.on ? camera.stream : null);
  const turn = value.turns?.at(-1);
  const waiting = pending || ["LOADING", "GENERATING"].includes(value.status);
  const live = !!turn && !value.report && !roundId;
  const inRoom = roomOpen && !roundId;
  const canUseVoiceRoom = !!mediaConfig?.speechEnabled;
  const handsFree = inRoom && voiceRoom && canUseVoiceRoom;
  const stageVisible = inRoom || (live && expanded);
  const openRoom = (voice: boolean) => {
    unlock();
    setExpanded(true);
    setVoiceRoom(voice);
    setRoomOpen(true);
  };
  const closeRoom = () => {
    camera.stop();
    stop();
    setAutoListening(false);
    setAutoProcessing(false);
    setVoiceRoom(false);
    setRoomOpen(false);
  };
  const switchToText = () => {
    setVoiceRoom(false);
    setAutoListening(false);
    setAutoProcessing(false);
  };
  const sendVoice = (text: string) => {
    if (text.length > 3000) {
      edit(text);
      switchToText();
      return;
    }
    return run(() => submit(text));
  };
  const voiceProps = {
    disabled: busy || disabled || waiting || loadError || submitted || !mediaConfig,
    remaining: 3000 - answer.length - (answer.trim() ? 1 : 0),
    onBusy: handleVoiceBusy,
    onAppend: (text: string) => edit((answer + (answer.trim() ? "\n" : "") + text).slice(0, 3000)),
  };
  useLayoutEffect(() => {
    const dialog = roomDialog.current!;
    const destination = inRoom ? roomContent.current : inlineContent.current;
    // Keep the canvas, answer field and active media mounted in both views.
    if (destination && practiceSurface.parentElement !== destination) destination.append(practiceSurface);
    if (inRoom && live) roomHadQuestion.current = true;
    if (inRoom && value.report && roomHadQuestion.current) {
      roomHadQuestion.current = false;
      setRoomOpen(false);
      setVoiceRoom(false);
      setTopic("");
    }
    if (inRoom) {
      if (!dialog.open) dialog.showModal();
    } else {
      if (dialog.open) dialog.close();
      if (roomHadQuestion.current || value.report) reportHeading.current?.focus();
      roomHadQuestion.current = false;
    }
  }, [inRoom, live, value.report, practiceSurface]);
  const questionId = turn?.id;
  const exchanges = turn?.exchanges || [];
  const pendingExchange = value.pendingExchange;
  const prompt = exchanges.at(-1)?.reply || turn?.question || "";
  const promptKey = questionId + ":" + exchanges.length;
  const handleAutoListening = useCallback((active: boolean) => {
    setAutoListening(active);
    if (active) {
      spokenPrompt.current = promptKey;
      stop();
    }
  }, [promptKey, stop]);
  const voiceReadyForPrompt = voiceReady !== null && voiceReady.turnId === questionId && voiceReady.exchangeCount === exchanges.length;
  const playbackAllowed = inRoom && sound && !!questionId && !!mediaConfig && speechSupported;
  const needsPlayback = playbackAllowed && (!handsFree || voiceReadyForPrompt) && !waiting && !loadError && !voiceBusy && !autoListening && !autoProcessing &&
    value.status === "ACTIVE" && spokenPrompt.current !== promptKey;
  useLayoutEffect(() => {
    if (!needsPlayback || !questionId) return;
    spokenPrompt.current = promptKey;
    speak(prompt, { projectId, turnId: questionId, exchangeCount: exchanges.length });
  }, [needsPlayback, projectId, questionId, promptKey, prompt, exchanges.length, speak]);
  useLayoutEffect(() => {
    if (playbackAllowed) return;
    spokenPrompt.current = "";
    stop();
  }, [playbackAllowed, stop]);
  useEffect(() => {
    return stop;
  }, [stop]);
  useLayoutEffect(() => {
    if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [questionId, exchanges.length, pendingExchange]);
  useEffect(() => {
    if (!stageVisible) camera.stop();
  }, [stageVisible, camera.stop]);
  const listening = autoListening || voiceBusy || face.speaking;
  const thinking = !loadError && (pending || value.status === "GENERATING");
  const avatarState = speaking ? "speaking" : thinking ? "thinking" : listening ? "listening" : "idle";
  const avatarStatus = speaking ? "面试官正在提问" : thinking ? "面试官正在思考" : preparing ? "准备播报" : listening ? "正在听你的回答" : face.face ? "面试官正在看着你" : "等待你的回答";
  const action = <Button disabled={busy || voiceBusy || autoProcessing || (!loadError && (disabled || waiting || answer.length > 3000 || (value.status === "ACTIVE" && !answer.trim())))} onClick={() => {
    setExpanded(true); if (loadError) void load(); else void run(() => submit());
  }}>
    {loadError ? "重新读取训练状态" : value.status === "LOADING" ? "正在读取…" : pending || value.status === "GENERATING" ? "正在生成，自动恢复进度…" : value.status === "ACTIVE" ? "提交回答" : value.status === "AVAILABLE" ? "开始五轮训练" : "重试或恢复训练"}<ArrowRight size={16} />
  </Button>;
  const exportPractice = () => {
    const report = value.report;
    if (!report) return;
    const retest = value.retest;
    const original = value.turns?.find(t => t.id === retest?.turnId);
    const comparison = retest?.report?.comparisons?.[0];
    const text = ["# 项目追问官 · 项目练习复盘", `反馈模式：${value.modelMode === "live" ? "AI 模型，结论仍需核对" : "规则演示，不构成 AI 技术评估"}`,
      "## 清晰的部分", ...report.clearParts.map(t => "- " + t),
      ...report.findings.flatMap((finding, i) => [`\n## 补充方向 ${i + 1}：${finding.topic}`, finding.assessment, "建议任务：" + finding.task,
        ...finding.evidence.map(e => "原回答：" + e.quote), ...finding.materials.map(m => "材料依据：" + m.text)]),
      "\n## 完整问答", ...(value.turns || []).flatMap((t, i) => [`\n### ${i + 1}. ${t.question}`, t.answer]),
      ...(retest?.status === "COMPLETED" && original
        ? ["\n## 专项复测", original.question, "初答：" + original.answer, "补答：" + retest.answer,
          comparison?.assessment || "请结合两次原回答自行核对新增细节与待验证事项。"]
        : []),
      "\n回答属于用户自述，技术结论仍需结合代码与测试核对；不承诺面试或录用结果。"].join("\n\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "项目追问官-项目训练复盘.md"; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const answeredTurns = value.turns?.filter(t => t.answer) || [];
  const submittedHistory = answeredTurns.length > 0 && <details className="practice-footnote">
    <summary>查看本轮已提交问答（{answeredTurns.length}）</summary>
    {answeredTurns.map(t => <article key={t.id}><h4>{t.question}</h4><p style={{ whiteSpace: "pre-wrap" }}>{t.answer}</p></article>)}
  </details>;
  const messages = <>
    {disabled && !roundId && <p className="practice-footnote">请先保存项目材料，再继续训练。</p>}
    {notice && <p className="practice-footnote" role="status">{notice}</p>}
    {error && <p className="practice-error" role="alert">{error}</p>}
  </>;
  return <><section id="project-practice" className="practice-card" aria-label="我的项目五轮训练">
    <div className="practice-header">
      <span className="practice-icon"><Sparkles size={22} strokeWidth={1.6} /></span>
      <div className="practice-heading"><h2>{roundId && value.roundNumber ? `第 ${value.roundNumber} 轮训练` : "项目训练"}</h2></div>
      {roundId && <Button secondary onClick={() => go("/projects/" + projectId)}>返回当前训练</Button>}
      {turn && <span className="practice-badge">{value.report ? "已完成" : `${value.turns?.length || 1} / ${value.maxTurns || 1}`}</span>}
      {!inRoom && loadError && !turn && action}
      {!roundId && !live && !value.report && <Button onClick={() => openRoom(false)}>
        <Maximize2 size={16} /> 进入面试室
      </Button>}
      {live && (
        <div className="practice-room-entry">
          <button type="button" className="button secondary" aria-haspopup="dialog" onClick={() => openRoom(false)}>
            <Maximize2 size={16} aria-hidden="true" />进入面试室{canUseVoiceRoom && "（文字）"}
          </button>
          {canUseVoiceRoom && (
            <>
              <button type="button" className="button" aria-haspopup="dialog" aria-describedby="practice-voice-consent" onClick={() => openRoom(true)}>
                <Mic size={16} aria-hidden="true" />同意并进入语音面试
              </button>
              <small id="practice-voice-consent">说话停顿后，录音会自动发往阿里云百炼转写。可随时暂停麦克风。</small>
            </>
          )}
        </div>
      )}
      {turn && <button className="practice-toggle" aria-expanded={expanded} aria-controls="practice-content" onClick={() => setExpanded(!expanded)}>
        {expanded ? "收起训练" : "展开训练"}{expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
      </button>}
    </div>
    <div id="practice-content" hidden={!expanded}>
    {!inRoom && submittedHistory}
    <div ref={inlineContent} />
    {createPortal((inRoom || turn) && <div className={"practice-body" + (stageVisible ? " is-live" : " is-completed")}>
        {stageVisible && <div className="practice-stage-col">
          <div className="live-stage">
            <InterviewerAvatar state={avatarState} mouthLevel={mouthLevel} presence={presence} />
            <div className="stage-top">
              <span className="live-indicator"><span className="status-dot" />{avatarStatus}</span>
              {!inRoom && <span className="live-indicator">项目追问 · 中文</span>}
            </div>
            {speaking && !inRoom && <div className="stage-subtitle">{prompt}</div>}
            <div className="stage-bottom">
              <div className="stage-name"><strong>陈老师</strong><p>技术面试官</p></div>
              <div className="camera-box">
                {camera.on && camera.stream ? <>
                  <video autoPlay playsInline muted aria-label="你的摄像头预览" ref={el => { if (el) el.srcObject = camera.stream; }} />
                  <span className="camera-caption">你</span>
                </> : <><CameraOff size={18} aria-hidden="true" /><span>你的摄像头尚未开启</span></>}
              </div>
            </div>
          </div>
          <div className="live-control-bar" role="group" aria-label="训练媒体控件">
            <button type="button" className="round-control" aria-pressed={sound} disabled={!speechSupported}
              aria-label={sound ? "关闭面试官声音" : "开启面试官声音"} title={sound ? "关闭面试官声音" : "开启面试官声音"}
              onClick={() => setSound(!sound)}>{sound ? <Volume2 size={19} /> : <VolumeX size={19} />}</button>
            <button type="button" className="round-control" aria-label="重新播报本题" title="重新播报本题"
              disabled={!turn || !live || !speechSupported || !sound || speaking || preparing || voiceBusy || autoListening || autoProcessing || waiting} onClick={() => {
                if (!turn) return;
                unlock();
                speak(prompt, { projectId, turnId: turn.id, exchangeCount: exchanges.length });
              }}><RotateCcw size={18} /></button>
            <button type="button" className="round-control" aria-pressed={camera.on}
              aria-label={camera.on ? "关闭摄像头" : "开启摄像头"} title={camera.on ? "关闭摄像头" : "开启摄像头"}
              onClick={() => void camera.toggle()}>{camera.on ? <Camera size={19} /> : <CameraOff size={19} />}</button>
          </div>
          {camera.error && <p className="media-error" role="status">{camera.error}</p>}
          {!speechSupported && <p className="media-error" role="status">当前浏览器不支持语音播报，可继续文字训练。</p>}
          <p className="control-caption">摄像头仅用于本机预览和动作识别。</p>
        </div>}
        <div className="practice-live-right">
        {inRoom && !live ? (
          <form className="practice-question practice-setup" onSubmit={event => {
            event.preventDefault();
            if (disabled || busy || waiting || loadError) return;
            unlock();
            void run(() => submit(undefined, !!value.report, topic));
          }}>
            <h3>{value.report ? "开始新一轮" : "开始项目面试"}</h3>
            {loadError ? action : <>
              {(!value.roundId || value.report) && <label>
                面试主题（选填）
                <input value={topic} maxLength={200} disabled={busy || waiting}
                  onChange={event => setTopic(event.target.value)}
                  placeholder="例如：任务调度的故障恢复" />
                <small>留空时，面试官会根据项目材料出题。</small>
              </label>}
              <Button type="submit" disabled={disabled || busy || waiting || value.retest?.status === "GENERATING"}>
                {waiting ? "正在准备…" : value.status === "FAILED" && !value.report
                  ? "重试或恢复训练" : "开始五轮训练"}
                <ArrowRight size={16} />
              </Button>
            </>}
          </form>
        ) : turn && <div className="practice-question"><span className="practice-kicker"><MessageSquare size={15} /> 项目追问 · {String(value.turns?.length || 1).padStart(2, "0")}</span>
          <h3>{turn.question}</h3>
          {value.interviewTopic && <p>本轮主题：{value.interviewTopic}</p>}
          <p>结合你实际负责的部分回答；没有做过或尚未验证的内容，可以直接说明。</p>
          {value.modelMode && <small>{value.modelMode === "demo" ? "规则演示，非AI评估" : "真实AI反馈，技术建议仍需核对"}</small>}
          {!value.report && <div className="question-progress-row"><span>第 {value.turns?.length || 1} / {value.maxTurns || 1} 题</span>
            <div className="question-progress" aria-hidden="true"><span style={{ width: `${Math.min(100, ((value.turns?.length || 1) / (value.maxTurns || 1)) * 100)}%` }} /></div>
          </div>}
        </div>}
        {live && (exchanges.length > 0 || pendingExchange) && (
          <section className="practice-dialogue" aria-label="本题对话">
            <h3>本题对话</h3>
            <ol className="practice-dialogue-messages" ref={transcript} aria-live="polite">
              {exchanges.map(({ answer: text, reply }, index) => (
                <li key={index}>
                  <p><strong>你</strong>{text}</p>
                  <p><strong>陈老师</strong>{reply}</p>
                </li>
              ))}
              {pendingExchange && <li><p><strong>你</strong>{pendingExchange.answer}</p></li>}
            </ol>
          </section>
        )}
        {handsFree && live && turn && (
          <>
            <PracticeConversationVoice
              projectId={projectId}
              turnId={turn.id}
              exchangeCount={exchanges.length}
              enabled
              suspended={voiceProps.disabled || value.status !== "ACTIVE" || !!answer.trim()}
              promptPlaying={needsPlayback || preparing || speaking}
              onUtterance={sendVoice}
              onListening={handleAutoListening}
              onProcessing={setAutoProcessing}
              onReady={setVoiceReady}
            />
            <div className="practice-answer-actions">
              <button type="button" className="practice-voice-switch" onClick={switchToText}>改用文字回答</button>
              {(loadError || value.status === "FAILED") && action}
            </div>
            {answer.trim() && (
              <p className="practice-voice-status">有一段未发送的草稿，可改用文字回答继续编辑。</p>
            )}
          </>
        )}
        {live && turn && !handsFree && <div className="practice-answer"><label>我的回答
          <textarea aria-label="我的回答" rows={6} maxLength={3000} disabled={busy || disabled || waiting || loadError || submitted} value={answer} onChange={e => edit(e.target.value)} placeholder="从你的职责、具体实现和验证方式说起…" />
        </label>
        {answer.length > 3000 && <p className="practice-error" role="alert">转写已保留，请编辑到 3000 字以内再发送。</p>}
        {mediaConfig?.speechEnabled && !browserVoice ? (
          <VoiceInput
            key={turn.id}
            projectId={projectId}
            turnId={turn.id}
            {...voiceProps}
            disabled={voiceProps.disabled || value.status !== "ACTIVE"}
          />
        ) : <ExperienceVoice key={turn.id} {...voiceProps} />}
        {mediaConfig && !mediaConfig.speechEnabled && (
          <p className="practice-voice-status">百炼 ASR 暂未启用，当前使用浏览器识别。</p>
        )}
        {mediaConfig?.speechEnabled && (
          <button
            className="practice-voice-switch"
            type="button"
            disabled={voiceBusy}
            onClick={() => setBrowserVoice(!browserVoice)}
          >
            {browserVoice ? "改用百炼 ASR" : "改用浏览器识别"}
          </button>
        )}
        <div className="practice-answer-actions"><small>{answer.length} / 3000</small>{action}</div>
        {inRoom && canUseVoiceRoom && !voiceBusy && !answer.trim() && value.status === "ACTIVE" && (
          <button type="button" className="practice-voice-switch" onClick={() => { unlock(); setVoiceRoom(true); }}>
            同意录音自动发送至百炼，开始语音面试
          </button>
        )}
        </div>}
        {inRoom && <>{messages}{submittedHistory}</>}
        </div>
      </div>, practiceSurface)}
      {value.report && <div className="practice-feedback"><h3 ref={reportHeading} tabIndex={-1}>针对你的回答</h3>
        <div className="action-row">
          <Button secondary onClick={exportPractice}><Download size={15} />导出本轮复盘</Button>
          {!roundId && !!value.roundId && <Button disabled={busy || disabled || waiting || loadError || value.retest?.status === "GENERATING"}
            onClick={() => openRoom(false)}>
            {pending ? "正在开始…" : "开始新一轮"} <ArrowRight size={15} />
          </Button>}
        </div>
        <ul className="practice-strengths">{value.report.clearParts.map((s, i) => <li key={i}><Check size={15} />{s}</li>)}</ul>
        <div className="practice-findings">{value.report.findings.map((f, i) => <article key={i}>
          <span className="practice-kicker">改进方向 {String(i + 1).padStart(2, "0")}</span><h4>{f.topic}</h4>
          <p>{f.assessment}</p>{f.supportExplanation && <p>判断依据（AI说明）：{f.supportExplanation}</p>}<p className="practice-task"><strong>{i === 0 ? "优先完成" : "下一步"}</strong>{f.task}</p>
          <EvidenceReview finding={f} />
          {f.evidence.length > 0 && <details><summary>查看回答依据</summary>{f.evidence.map((e, n) => <blockquote key={e.turnId + n}>{e.quote}</blockquote>)}</details>}
        </article>)}</div>
        <PracticeRetest projectId={projectId} roundId={value.roundId ?? roundId} report={value.report} retest={value.retest}
          disabled={disabled || busy || loadError} onChange={acceptRetest} reload={load} />
        <p className="practice-footnote">复盘只使用本轮已提交的回答。补充说明属于你的自述，仍需结合代码与测试核对。</p>
        <PracticeNext projectId={projectId} answer={value.turns?.map(t => t.answer).filter(Boolean).join("\n\n") || ""} disabled={disabled}
          onSaved={onSaved} onEditMaterials={onEditMaterials} run={run} busy={busy} />
        <PracticeReview projectId={projectId} run={run} busy={busy} />
      </div>}
      {!inRoom && messages}
    </div>
  </section>
  <dialog
    ref={roomDialog}
    className="practice-room"
    aria-labelledby="practice-room-title"
    onCancel={event => {
      event.preventDefault();
      closeRoom();
    }}
  >
    <header className="practice-room-header">
      <div>
        <h2 id="practice-room-title">项目面试室</h2>
        <p>{projectName}</p>
      </div>
      <Button secondary onClick={closeRoom}>
        <ArrowLeft size={16} aria-hidden="true" />返回项目
      </Button>
    </header>
    <div className="practice-room-content" ref={roomContent} />
  </dialog>
  </>;
}

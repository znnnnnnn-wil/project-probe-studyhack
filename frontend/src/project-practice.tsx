import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, Loading } from "./ui";
import type { Actions } from "./ui";
import { useProjectPractice } from "./use-project-practice";
import { ArrowLeft, ArrowRight, Camera, CameraOff, FolderOpen, LoaderCircle, MessageSquare, Mic, RotateCcw, Volume2, VolumeX } from "lucide-react";
import "./project-practice.css";
import type { Project } from "./types";
import { PracticeConversationVoice } from "./practice-conversation-voice";
import { InterviewerAvatar } from "./interviewer-avatar";
import { useCameraPreview, useQuestionSpeech } from "./use-interviewer-media";
import { useFacePresence } from "./use-face-presence";
import { useApiResource } from "./use-api-resource";

const voiceConsent = "面试官播报时可以直接开口打断。说话停顿后，录音会自动发往阿里云百炼转写。可随时暂停麦克风。";

export function ProjectInterview({ id, fromHistory, ...props }: Actions & { id: string; fromHistory: boolean }) {
  const projectId = encodeURIComponent(id);
  const { data, error, reload } = useApiResource<Project>(`/projects/${projectId}`);
  const exitLabel = fromHistory ? "返回项目训练记录" : "返回项目列表";
  const onExit = () => window.location.replace(fromHistory ? `#/history/${projectId}` : "#/projects");
  if (error) return <section className="page">
    <p role="alert">{error}</p>
    <div className="action-row">
      <Button secondary onClick={onExit}>{exitLabel}</Button>
      <Button onClick={reload}>重新读取项目信息</Button>
    </div>
  </section>;
  if (!data) return <Loading />;
  return <ProjectPractice projectId={id} project={data} exitLabel={exitLabel} onExit={onExit} {...props} />;
}

function ProjectPractice({ projectId, project, exitLabel, onExit, run, busy }: Actions & {
  projectId: string; project: Project; exitLabel: string; onExit: () => void;
}) {
  const { value, answer, staleDraft, edit, discardDraft, error, loadError, pending, cancelling, notice, submitted, finalTurn, reportGenerating, load, submit, cancel } = useProjectPractice(projectId);
  const [topic, setTopic] = useState("");
  const activeRound = useRef<string | undefined>(undefined);
  const [voiceAccepted, setVoiceAccepted] = useState(false);
  const [voiceReady, setVoiceReady] = useState<{ turnId: string; exchangeCount: number } | null>(null);
  const roomDialog = useRef<HTMLDialogElement>(null);
  const transcript = useRef<HTMLOListElement>(null);
  const spokenPrompt = useRef("");
  const [autoListening, setAutoListening] = useState(false);
  const [autoProcessing, setAutoProcessing] = useState(false);
  const [sound, setSound] = useState(true);
  const { data: mediaConfig, loading: checkingVoice, reload: checkVoice } =
    useApiResource<{ ttsEnabled?: boolean; speechEnabled?: boolean }>("/config");
  const { speaking, preparing, speak, stop, unlock, supported: speechSupported, mouthLevel } = useQuestionSpeech(!!mediaConfig?.ttsEnabled);
  const camera = useCameraPreview();
  const { presence, snapshot: face } = useFacePresence(camera.on ? camera.stream : null);
  const turn = value.turns?.at(-1);
  const waiting = pending || ["LOADING", "GENERATING"].includes(value.status);
  const live = !!turn && !value.report;
  const finishing = live && finalTurn && waiting && !loadError && !cancelling;
  const showingReportProgress = finishing && reportGenerating;
  const reportNeedsRetry = live && finalTurn && submitted && value.status === "FAILED";
  const canUseVoiceRoom = !!mediaConfig?.speechEnabled;
  const handsFree = voiceAccepted && canUseVoiceRoom;
  const startBlocked = busy || waiting || cancelling || loadError || value.retest?.status === "GENERATING";
  const closeRoom = () => {
    camera.stop();
    stop();
    onExit();
  };
  const cancelInterview = async () => {
    camera.stop();
    stop();
    if (await cancel()) closeRoom();
  };
  const enableVoice = () => {
    unlock();
    setVoiceAccepted(true);
  };
  const startInterview = () => {
    if (startBlocked || !canUseVoiceRoom) return;
    enableVoice();
    void run(() => submit(undefined, !!value.report, topic));
  };
  const sendVoice = (text: string) => {
    if (text.length > 3000) {
      edit(text);
      return;
    }
    return run(() => submit(text));
  };
  useLayoutEffect(() => {
    const dialog = roomDialog.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  useEffect(() => {
    const roundId = value.roundId;
    if (!roundId) return;
    if (!value.report) activeRound.current = roundId;
    else if (activeRound.current === roundId) {
      activeRound.current = undefined;
      window.location.replace(`#/history/${encodeURIComponent(projectId)}/${encodeURIComponent(roundId)}`);
    }
  }, [projectId, value.report, value.roundId]);
  const questionId = turn?.id;
  const exchanges = turn?.exchanges || [];
  const pendingExchange = value.pendingExchange || (pending && answer.trim() ? { answer } : undefined);
  const hasDraft = live && !submitted && !value.pendingExchange && !!answer.trim();
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
  const playbackAllowed = live && value.status === "ACTIVE" && handsFree && sound && speechSupported && !cancelling;
  const needsPlayback = playbackAllowed && voiceReadyForPrompt && !waiting && !loadError && !autoListening && !autoProcessing &&
    spokenPrompt.current !== promptKey;
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
  const listening = autoListening || face.speaking;
  const thinking = !showingReportProgress && !loadError && (pending || value.status === "GENERATING");
  const avatarState = speaking ? "speaking" : thinking ? "thinking" : listening ? "listening" : "idle";
  const avatarStatus = showingReportProgress ? "面试已结束" : finishing ? "正在处理最后一题" :
    speaking ? "面试官正在提问" : thinking ? "面试官正在思考" : preparing ? "准备播报" : listening ? "正在听你的回答" : face.face ? "面试官正在看着你" : "等待你的回答";
  const action = <Button disabled={busy || cancelling || autoProcessing || (!loadError && (waiting || (!canUseVoiceRoom && !reportNeedsRetry) || (hasDraft && answer.length > 3000)))} onClick={() => {
    if (loadError) void load(); else void run(() => submit());
  }}>
    {loadError ? "重新读取训练状态" : waiting ? "正在生成，自动恢复进度…" : hasDraft ? "重试发送" :
      reportNeedsRetry ? "重试生成报告" : "重试或恢复训练"}<ArrowRight size={16} />
  </Button>;
  const voiceUnavailable = checkingVoice ? <p role="status">正在检查语音服务…</p> : <>
    <p role="status">百炼 ASR 暂未就绪，当前无法开始语音面试。</p>
    <Button secondary onClick={checkVoice}>重新检查语音服务</Button>
  </>;
  const answeredTurns = value.turns?.filter(t => t.answer) || [];
  const projectFields: { label: string; value: string; wide?: boolean }[] = [
    { label: "目标岗位", value: project.targetRole ?? "" },
    { label: "技术栈", value: project.stack ?? "" },
    { label: "项目简介", value: project.background ?? "", wide: true },
  ].filter(f => f.value.trim());
  const resumeText = (project.resume ?? "").trim();
  const submittedHistory = answeredTurns.length > 0 && <details className="practice-footnote">
    <summary>查看本轮已提交问答（{answeredTurns.length}）</summary>
    {answeredTurns.map(t => <article key={t.id}><h4>{t.question}</h4><p style={{ whiteSpace: "pre-wrap" }}>{t.answer}</p></article>)}
  </details>;
  const messages = <>
    {notice && !waiting && <p className="practice-footnote" role="status">{notice}</p>}
    {live && error && <p className="practice-error" role="alert">{error}</p>}
  </>;
  return <dialog
    ref={roomDialog}
    className="practice-room project-interview-room"
    aria-label="项目面试室"
    onCancel={event => {
      event.preventDefault();
      closeRoom();
    }}
  >
    <div className="practice-room-content">
      <div className="practice-body">
        <div className="practice-stage-col">
          <div className="live-stage">
            <InterviewerAvatar state={avatarState} mouthLevel={mouthLevel} presence={presence} />
            <div className="stage-top">
              <span className="live-indicator"><span className="status-dot" />{avatarStatus}</span>
              {(camera.error || !speechSupported) && <div className="practice-stage-notices">
                {camera.error && <p className="media-error" role="status">{camera.error}</p>}
                {!speechSupported && <p className="media-error" role="status">语音播报暂不可用，请阅读右侧题目。</p>}
              </div>}
            </div>
            <div className="stage-bottom">
              <div className="stage-name"><strong>陈老师</strong><p>技术面试官</p></div>
              <div className="practice-media-controls">
                <div className="live-control-bar" role="group" aria-label="训练媒体控件">
                  <button type="button" className="round-control" aria-pressed={sound} disabled={!speechSupported}
                    aria-label={sound ? "关闭面试官声音" : "开启面试官声音"} title={sound ? "关闭面试官声音" : "开启面试官声音"}
                    onClick={() => setSound(!sound)}>{sound ? <Volume2 size={19} /> : <VolumeX size={19} />}</button>
                  <button type="button" className="round-control" aria-label="重新播报本题" title="重新播报本题"
                    disabled={!turn || !playbackAllowed || !voiceReadyForPrompt || speaking || preparing || autoListening || autoProcessing || waiting} onClick={() => {
                      if (!turn) return;
                      unlock();
                      spokenPrompt.current = promptKey;
                      speak(prompt, { projectId, turnId: turn.id, exchangeCount: exchanges.length });
                    }}><RotateCcw size={18} /></button>
                  <button type="button" className="round-control" aria-pressed={camera.on} aria-describedby="project-camera-caption"
                    aria-label={camera.on ? "关闭摄像头" : "开启摄像头"} title={camera.on ? "关闭摄像头" : "开启摄像头"}
                    onClick={() => void camera.toggle()}>{camera.on ? <Camera size={19} /> : <CameraOff size={19} />}</button>
                </div>
                <p className="control-caption" id="project-camera-caption">摄像头仅用于本机预览和动作识别。</p>
              </div>
              <div className="camera-box">
                {camera.on && camera.stream ? <>
                  <video autoPlay playsInline muted aria-label="你的摄像头预览" ref={el => { if (el) el.srcObject = camera.stream; }} />
                  <span className="camera-caption">你</span>
                </> : <><CameraOff size={18} aria-hidden="true" /><span>你的摄像头尚未开启</span></>}
              </div>
            </div>
          </div>
        </div>
        <div className="practice-live-right">
        <header className="project-interview-heading">
          <p>{project.name}</p>
          <Button secondary onClick={closeRoom}>
            <ArrowLeft size={16} aria-hidden="true" />{exitLabel}
          </Button>
        </header>
        {showingReportProgress ? (
          <section className="practice-question practice-report-loading" role="status">
            <LoaderCircle className="spin" size={28} aria-hidden="true" />
            <div>
              <h3>正在生成面试报告</h3>
              <p>回答已保存，报告完成后会自动打开。</p>
            </div>
          </section>
        ) : !live ? (
          <>
          <section className="practice-project-info" aria-label="项目相关信息">
            <div className="practice-project-info-head">
              <span className="practice-kicker"><FolderOpen size={15} /> 项目信息</span>
              {typeof project.version === "number" && <span className="practice-badge">材料 v{project.version}</span>}
            </div>
            {projectFields.length > 0 ? <dl className="practice-project-fields">
              {projectFields.map(f => <div key={f.label} className={f.wide ? "wide" : undefined}>
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
              </div>)}
            </dl> : <p className="practice-project-empty">项目材料还比较空。填写并保存项目名称与项目简介后，面试官会据此出题。</p>}
            {resumeText && <details className="practice-project-more">
              <summary>项目经历原文</summary>
              <p>{resumeText}</p>
            </details>}
          </section>
          <section className="practice-question practice-setup">
            <h3>{value.report ? "开始新一轮" : "开始项目面试"}</h3>
            {error && <p className="practice-error" role="alert">{error}</p>}
            {loadError || value.status === "GENERATING" ? action : <>
              {(!value.roundId || value.report) && <label>
                面试主题（选填）
                <input value={topic} maxLength={200} disabled={busy || waiting}
                  onChange={event => setTopic(event.target.value)}
                  placeholder="例如：任务调度的故障恢复" />
                <small>留空时，面试官会根据项目材料出题。</small>
              </label>}
              {canUseVoiceRoom ? <>
                <button type="button" className="button" aria-describedby="practice-voice-consent"
                  disabled={startBlocked} onClick={startInterview}>
                  <Mic size={16} aria-hidden="true" />
                  {waiting ? "正在准备…" : value.status === "FAILED" && !value.report
                    ? "重试或恢复训练" : "同意并开始语音面试"}
                </button>
                <small id="practice-voice-consent">{voiceConsent}</small>
              </> : voiceUnavailable}
            </>}
          </section>
          </>
        ) : turn && <div className="practice-question">
          <span className="practice-kicker"><MessageSquare size={15} /> 项目追问 · {String(value.turns?.length || 1).padStart(2, "0")}</span>
          <h3>{turn.question}</h3>
          {turn.explanation && !turn.answer && <p className="practice-footnote" role="status">
            正在讲解本题，没听懂可以继续问。学会后请说“我学会了”，{value.turns?.length === value.maxTurns ? "确认后生成本场报告。" : "确认后再继续下一题。"}
          </p>}
          {value.interviewTopic && <p>本轮主题：{value.interviewTopic}</p>}
          <p>结合你实际负责的部分回答；没有做过或尚未验证的内容，可以直接说明。</p>
          {value.modelMode && <small>{value.modelMode === "demo" ? "规则演示，非AI评估" : "真实AI反馈，技术建议仍需核对"}</small>}
          {!value.report && <div className="question-progress-row"><span>第 {value.turns?.length || 1} / {value.maxTurns || 1} 题</span>
            <div className="question-progress" aria-hidden="true"><span style={{ width: `${Math.min(100, ((value.turns?.length || 1) / (value.maxTurns || 1)) * 100)}%` }} /></div>
          </div>}
        </div>}
        {live && !showingReportProgress && (exchanges.length > 0 || pendingExchange) && (
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
        {handsFree && !showingReportProgress && <PracticeConversationVoice
              projectId={projectId}
              turnId={live ? turn?.id ?? "" : ""}
              exchangeCount={exchanges.length}
              enabled
              suspended={!live || busy || waiting || cancelling || loadError || submitted || value.status !== "ACTIVE" || hasDraft}
              promptPlaying={needsPlayback || preparing || speaking}
              cancelling={cancelling}
              cancelDisabled={!value.roundId || !!value.report}
              onCancel={() => void cancelInterview()}
              onUtterance={sendVoice}
              onStateConflict={load}
              onListening={handleAutoListening}
              onProcessing={setAutoProcessing}
              onReady={setVoiceReady}
        />}
        {!handsFree && value.roundId && !value.report && <Button secondary disabled={cancelling}
          onClick={() => void cancelInterview()}>{cancelling ? "正在取消…" : "取消语音面试"}</Button>}
        {live && (loadError || (value.status === "FAILED" && !hasDraft)) && action}
        {live && !showingReportProgress && !handsFree && !loadError && (canUseVoiceRoom ? value.status === "ACTIVE" && !hasDraft && (
          <div className="practice-voice-consent">
            <button type="button" className="button" aria-describedby="practice-voice-consent"
              disabled={busy || waiting} onClick={enableVoice}>
              <Mic size={16} aria-hidden="true" />同意并进入语音面试
            </button>
            <small id="practice-voice-consent">{voiceConsent}</small>
          </div>
        ) : voiceUnavailable)}
        {hasDraft && !waiting && !loadError && <section className="practice-draft" aria-label={staleDraft ? "旧追问的回答草稿" : "未发送的回答"}>
          <h4>{staleDraft ? "旧追问的回答草稿" : "未发送的回答"}</h4>
          <p>{answer}</p>
          {staleDraft ? (
            <small>追问进度已变化。可以复制这段草稿，放弃后继续回答当前追问。</small>
          ) : answer.length > 3000 && <small>这段回答太长，可以重新录制，再分段回答。</small>}
          <div className="action-row">
            {!staleDraft && action}
            <Button secondary disabled={busy || waiting || autoProcessing} onClick={discardDraft}>放弃这段回答</Button>
          </div>
        </section>}
        {messages}{live && submittedHistory}
        </div>
      </div>
    </div>
  </dialog>
}

import React, { useState } from "react";
import { Button } from "./ui";
import type { Actions } from "./ui";
import { useProjectPractice } from "./use-project-practice";
import { ArrowRight, Check, ChevronDown, ChevronUp, Download, MessageSquare, Sparkles } from "lucide-react";
import "./project-practice.css";
import { PracticeNext } from "./practice-next";
import { PracticeReview } from "./practice-review";
import type { Project } from "./types";
import { EvidenceReview } from "./evidence-review";
import { PracticeRetest } from "./practice-retest";
import { ExperienceVoice } from "./experience-voice";
import "./experience-report.css";

export function ProjectPractice({ projectId, disabled, onSaved, onReview, run, busy }: Actions & {
  projectId: string; disabled: boolean; onSaved: (project: Project) => void; onReview: () => void;
}) {
  const { value, answer, edit, error, loadError, pending, notice, submitted, load, submit, accept } = useProjectPractice(projectId);
  const [expanded, setExpanded] = useState(true);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const turn = value.turns?.at(-1);
  const multi = (value.maxTurns || 1) > 1;
  const waiting = pending || ["LOADING", "GENERATING"].includes(value.status);
  const action = <Button disabled={busy || voiceBusy || (!loadError && (disabled || waiting || (value.status === "ACTIVE" && !answer.trim())))} onClick={() => {
    setExpanded(true); if (loadError) void load(); else void run(submit);
  }}>
    {loadError ? "重新读取体验状态" : value.status === "LOADING" ? "正在读取…" : pending || value.status === "GENERATING" ? "正在生成，自动恢复进度…" : value.status === "ACTIVE" ? "提交体验回答" : value.status === "AVAILABLE" ? (multi ? "开始五轮训练" : "开始一题体验") : "重试或恢复体验"}<ArrowRight size={16} />
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
  return <section id="project-practice" className="practice-card" aria-label={multi ? "我的项目五轮训练" : "我的项目一题体验"}>
    <div className="practice-header">
      <span className="practice-icon"><Sparkles size={22} strokeWidth={1.6} /></span>
      <div className="practice-heading"><h2>{multi ? "围绕你的项目，连续追问五轮" : "先用自己的项目体验一题"}</h2>
        <p>每账号一轮免费训练，使用已保存的项目材料；无需购买。</p></div>
      {!turn && value.status !== "USED" ? action : <span className="practice-badge">{value.report ? "体验已完成" : value.status === "USED" ? "已体验" : `${value.turns?.length || 1} / ${value.maxTurns || 1}`}</span>}
      {turn && <button className="practice-toggle" aria-expanded={expanded} aria-controls="practice-content" onClick={() => setExpanded(!expanded)}>
        {expanded ? "收起体验" : "展开体验"}{expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
      </button>}
    </div>
    <div id="practice-content" hidden={!expanded}>
    {value.status === "USED" ? <p className="practice-footnote">本账号已完成免费训练，请回到首次训练的项目查看记录与复盘。</p> : <>
      {(value.turns?.length || 0) > 1 && <details className="practice-footnote"><summary>查看本轮已提交问答（{value.turns!.filter(t => t.answer).length}）</summary>{value.turns!.filter(t => t.answer).map(t => <article key={t.id}><h4>{t.question}</h4><p style={{ whiteSpace: "pre-wrap" }}>{t.answer}</p></article>)}</details>}
      {turn && <div className={"practice-body" + (value.report ? " is-completed" : "")}>
        <div className="practice-question"><span className="practice-kicker"><MessageSquare size={15} /> 项目追问 · {String(value.turns?.length || 1).padStart(2, "0")}</span>
          <h3>{turn.question}</h3>
          <p>结合你实际负责的部分回答；没有做过或尚未验证的内容，可以直接说明。</p>
          {value.modelMode && <small>{value.modelMode === "demo" ? "规则演示，非AI评估" : "真实AI反馈，技术建议仍需核对"}</small>}
        </div>
        {!value.report && <div className="practice-answer"><label>体验回答
          <textarea aria-label="体验回答" rows={6} maxLength={3000} disabled={busy || disabled || waiting || loadError || submitted} value={answer} onChange={e => edit(e.target.value)} placeholder="从你的职责、具体实现和验证方式说起…" />
        </label>
        <ExperienceVoice
          disabled={busy || disabled || waiting || loadError || submitted}
          remaining={3000 - answer.length - (answer.trim() ? 1 : 0)}
          onBusy={setVoiceBusy}
          onAppend={text => edit((answer + (answer.trim() ? "\n" : "") + text).slice(0, 3000))}
        />
        <div className="practice-answer-actions"><small>{answer.length} / 3000</small>{action}</div></div>}
      </div>}
      {value.report && <div className="practice-feedback"><h3>针对你的回答</h3>
        <Button secondary onClick={exportPractice}><Download size={15} />导出本轮复盘</Button>
        <ul className="practice-strengths">{value.report.clearParts.map((s, i) => <li key={i}><Check size={15} />{s}</li>)}</ul>
        <div className="practice-findings">{value.report.findings.map((f, i) => <article key={i}>
          <span className="practice-kicker">改进方向 {String(i + 1).padStart(2, "0")}</span><h4>{f.topic}</h4>
          <p>{f.assessment}</p>{f.supportExplanation && <p>判断依据（AI说明）：{f.supportExplanation}</p>}<p className="practice-task"><strong>{i === 0 ? "优先完成" : "下一步"}</strong>{f.task}</p>
          <EvidenceReview finding={f} />
          {f.evidence.length > 0 && <details><summary>查看回答依据</summary>{f.evidence.map((e, n) => <blockquote key={e.turnId + n}>{e.quote}</blockquote>)}</details>}
        </article>)}</div>
        <PracticeRetest projectId={projectId} report={value.report} retest={value.retest}
          disabled={disabled || busy || loadError} onChange={accept} reload={load} />
        <p className="practice-footnote">复盘只使用本轮已提交的回答。补充说明属于你的自述，仍需结合代码与测试核对。</p>
        <PracticeNext projectId={projectId} answer={value.turns?.map(t => t.answer).filter(Boolean).join("\n\n") || ""} disabled={disabled}
          onSaved={onSaved} onReview={onReview} run={run} busy={busy} />
        <PracticeReview projectId={projectId} run={run} busy={busy} />
      </div>}
      {disabled && <p className="practice-footnote">请先保存当前材料或事实核对修改，再继续体验。</p>}
      {!turn && <p className="practice-footnote">体验不能代替完整事实核对与训练。</p>}
    </>}{notice && <p className="practice-footnote" role="status">{notice}</p>}{error && <p className="practice-error" role="alert">{error}</p>}
    </div>
  </section>;
}

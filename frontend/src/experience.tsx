import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Check,
  CheckCheck,
  ChevronDown,
  Database,
  Download,
  FileText,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { go } from "./api";
import {
  dimensions,
  exportExperience,
  experienceKey,
  freshExperience,
  questionFor,
  readExperience,
  samples,
} from "./experience-data";
import "./competition.css";
import { QuickExperience } from "./quick-experience";

const scenarioMeta: Record<
  string,
  { icon: typeof Database; tone: string; level: string }
> = {
  booking: { icon: Database, tone: "blue", level: "入门 · 并发与一致性" },
  rag: { icon: Sparkles, tone: "teal", level: "进阶 · 检索与引用" },
  scheduler: { icon: CalendarClock, tone: "amber", level: "进阶 · 幂等与重试" },
};

export function ExperiencePage() {
  const params = new URLSearchParams(location.hash.split("?")[1]);
  return params.get("mode") === "quick" ? <QuickExperience /> : <FullExperience />;
}

function FullExperience() {
  const [state, setState] = useState(() => {
    const saved = readExperience();
    const selected = new URLSearchParams(location.hash.split("?")[1]).get(
      "sample",
    );
    return !saved.started && samples.some((p) => p.id === selected)
      ? freshExperience(selected!)
      : saved;
  });
  const [storageError, setStorageError] = useState("");
  const [view, setView] = useState<number | null>(null);
  const questionHead = useRef<HTMLHeadingElement>(null);
  const sample = samples.find((s) => s.id === state.sample)!;
  const complete = state.answers.length === 5;
  const index = Math.min(state.answers.length, 4);
  const shown = view ?? index;
  useEffect(() => {
    try {
      sessionStorage.setItem(experienceKey, JSON.stringify(state));
      setStorageError("");
    } catch {
      setStorageError(
        "浏览器未允许保存进度，刷新后可能需要重新开始。你仍可以完成练习并导出报告。",
      );
    }
  }, [state]);
  useEffect(() => {
    if (state.started) questionHead.current?.focus();
  }, [state.started, state.answers.length, view]);
  const reset = () => {
    if (
      !window.confirm(
        "重新开始会清除这轮示例的回答与笔记。请先导出需要保留的复盘。",
      )
    )
      return;
    setView(null);
    setState(freshExperience(state.sample));
  };
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([exportExperience(state)], {
        type: "text/markdown;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "项目追问官-练习复盘.md";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section className="experience-page">
      <div className="experience-top">
        <a href="#/">
          <ArrowLeft size={16} /> 返回首页
        </a>
        <span className="probe-label">本地规则演示 · 不调用模型</span>
        <span>回答仅保存在当前浏览器标签页</span>
      </div>
      {storageError && <p role="alert">{storageError}</p>}
      {!state.started ? (
        <div className="experience-intro">
          <div className="probe-eyebrow">
            <span /> 五轮，练清楚一个项目
          </div>
          <h1>
            选择一个场景，
            <br />
            开始你的<span>下一问。</span>
          </h1>
          <p>
            以下都是合成项目。你可以代入实现者作答，也可以直接说明“不确定”。
            <br />
            示例按固定维度追问，最终保留原文与自查清单，不对技术正确性评分。
          </p>
          <div className="experience-options">
            {samples.map((s, i) => {
              const meta = scenarioMeta[s.id];
              const Icon = meta.icon;
              const selected = state.sample === s.id;
              return (
                <button
                  key={s.id}
                  className={`experience-option tone-${meta.tone}`}
                  aria-pressed={selected}
                  onClick={() => setState(freshExperience(s.id))}
                >
                  <span className="experience-option-head">
                    <span className="experience-option-icon">
                      <Icon size={22} strokeWidth={1.7} />
                    </span>
                    <span className="experience-option-check" aria-hidden>
                      {selected ? <Check size={15} /> : `0${i + 1}`}
                    </span>
                  </span>
                  <span className="experience-option-tag">{s.label}</span>
                  <h2>{s.project.name}</h2>
                  <span className="experience-option-stack">
                    {s.project.stack}
                  </span>
                  <p>{s.project.problems}</p>
                  <span className="experience-option-foot">
                    <span>{meta.level}</span>
                    <span className="experience-option-pick">
                      {selected ? "已选择" : "选择此场景"}
                      <ArrowRight size={14} />
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="experience-intro-actions">
            <button
              className="button button-lg"
              onClick={() => setState((s) => ({ ...s, started: true }))}
            >
              开始五轮练习 <ArrowRight size={17} />
            </button>
            <span>职责 · 实现 · 失败 · 验证 · 取舍</span>
          </div>
        </div>
      ) : (
        <>
          <div className="experience-heading">
            <div>
              <div className="probe-eyebrow">
                {complete
                  ? "把回答变成可回看的准备"
                  : "从材料出发，沿着回答继续"}
              </div>
              <h1>
                {complete ? "这轮练习，留下了什么？" : sample.project.name}
              </h1>
              <p>
                {complete
                  ? "逐条核对你的解释，再记录需要补充的内容。勾选仅代表自行核对。"
                  : "不确定的地方可以直接说清，先把真实理解写下来。"}
              </p>
            </div>
            <button className="probe-text-button" onClick={reset}>
              <RotateCcw size={15} /> 重新开始
            </button>
          </div>
          <ol className="experience-progress" aria-label="五轮练习进度">
            {dimensions.map((d, i) => (
              <li
                key={d.title}
                aria-current={!complete && i === index ? "step" : undefined}
                className={
                  i < state.answers.length
                    ? "done"
                    : i === index && !complete
                      ? "current"
                      : ""
                }
              >
                <span>
                  {i < state.answers.length ? <Check size={14} /> : i + 1}
                </span>
                {d.title}
              </li>
            ))}
          </ol>
          {complete ? (
            <div className="experience-report">
              <div className="experience-report-bar">
                <span>
                  <CheckCheck size={20} /> 已保留 5 组问答与原文依据
                </span>
                <button className="button" onClick={download}>
                  <Download size={16} /> 导出复盘 Markdown
                </button>
              </div>
              {dimensions.map((d, i) => (
                <article className="experience-report-item" key={d.title}>
                  <div className="experience-report-title">
                    <span>0{i + 1}</span>
                    <h2>{d.title}</h2>
                    <label>
                      <input
                        type="checkbox"
                        checked={state.checked[i]}
                        onChange={(e) =>
                          setState((s) => ({
                            ...s,
                            checked: s.checked.map((v, n) =>
                              n === i ? e.target.checked : v,
                            ),
                          }))
                        }
                      />{" "}
                      我已自行核对
                    </label>
                  </div>
                  <h3>
                    {questionFor(state.sample, i, state.answers.slice(0, i))}
                  </h3>
                  <div className="experience-evidence-pair">
                    <div>
                      <span className="probe-label">我的原回答</span>
                      <p>{state.answers[i]}</p>
                    </div>
                    <div>
                      <span className="probe-label">材料原文 · {d.label}</span>
                      <p>{sample.project[d.field]}</p>
                    </div>
                  </div>
                  <div className="experience-task">
                    <strong>建议核对</strong>
                    {d.task}
                  </div>
                  <label>
                    补充笔记
                    <textarea
                      rows={2}
                      maxLength={1000}
                      value={state.notes[i]}
                      placeholder="记录要查看的代码、要补做的测试，或仍不确定的地方…"
                      onChange={(e) =>
                        setState((s) => ({
                          ...s,
                          notes: s.notes.map((v, n) =>
                            n === i ? e.target.value : v,
                          ),
                        }))
                      }
                    />
                  </label>
                </article>
              ))}
              <div className="experience-next">
                <ShieldCheck size={19} />
                <p>
                  这是规则引导的练习记录。原回答、材料引用和你的自查都可回看；它们不代表技术已独立验证。
                </p>
                <button
                  className="probe-text-button"
                  onClick={() => go("/projects/new")}
                >
                  换成我的真实项目 <ArrowRight size={16} />
                </button>
              </div>
            </div>
          ) : (
            <div className="experience-workspace">
              <aside className="experience-source">
                <div className="probe-eyebrow">
                  <FileText size={15} /> 这次追问的材料依据
                </div>
                <h2>{sample.project.name}</h2>
                <span className="probe-label">{sample.project.stack}</span>
                <div className="experience-source-focus">
                  <span>{dimensions[shown].label}</span>
                  <blockquote>
                    {sample.project[dimensions[shown].field]}
                  </blockquote>
                </div>
                <details>
                  <summary>
                    展开完整项目材料 <ChevronDown size={14} />
                  </summary>
                  {(
                    [
                      "background",
                      "responsibility",
                      "implementation",
                      "problems",
                      "verification",
                    ] as const
                  ).map((key, i) => (
                    <div key={key}>
                      <h3>
                        {
                          [
                            "项目背景",
                            "个人职责",
                            "关键实现",
                            "已知问题",
                            "验证记录",
                          ][i]
                        }
                      </h3>
                      <p>{sample.project[key]}</p>
                    </div>
                  ))}
                </details>
                <p className="experience-source-note">
                  合成示例，不代表你的实际经历。问题中的新增条件会明确标记为假设。
                </p>
              </aside>
              <div className="experience-conversation">
                <div className="experience-turn-label">
                  <span className="probe-avatar">问</span>
                  <strong>项目追问官</strong>
                  <span>
                    {dimensions[shown].title} / 0{shown + 1}
                  </span>
                </div>
                <h2 tabIndex={-1} ref={questionHead}>
                  {questionFor(
                    state.sample,
                    shown,
                    state.answers.slice(0, shown),
                  )}
                </h2>
                {view !== null ? (
                  <>
                    <span className="probe-label">你已提交的回答</span>
                    <p className="experience-saved-answer">
                      {state.answers[view]}
                    </p>
                    <button className="button" onClick={() => setView(null)}>
                      回到当前追问 <ArrowRight size={16} />
                    </button>
                  </>
                ) : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const answer = state.draft.trim();
                      if (answer)
                        setState((s) =>
                          s.answers.length >= 5
                            ? s
                            : {
                                ...s,
                                answers: [...s.answers, answer],
                                draft: "",
                              },
                        );
                    }}
                  >
                    <label>
                      我的回答
                      <textarea
                        autoComplete="off"
                        aria-label="本轮回答"
                        rows={7}
                        maxLength={3000}
                        value={state.draft}
                        placeholder="从实际步骤说起；没有做过的部分，直接说明。"
                        onChange={(e) =>
                          setState((s) => ({ ...s, draft: e.target.value }))
                        }
                      />
                    </label>
                    <div className="experience-submit">
                      <small>{state.draft.length} / 3000 · 草稿自动保留</small>
                      <button
                        className="button"
                        type="submit"
                        disabled={!state.draft.trim()}
                      >
                        {index === 4 ? "保存并查看复盘" : "保存回答，继续追问"}
                        <ArrowRight size={16} />
                      </button>
                    </div>
                  </form>
                )}
                {state.answers.length > 0 && (
                  <div className="experience-history">
                    <span className="probe-label">回看已提交的问答</span>
                    <div>
                      {state.answers.map((_, i) => (
                        <button
                          key={i}
                          className={view === i ? "active" : ""}
                          onClick={() => setView(i)}
                        >
                          <Check size={13} /> {dimensions[i].title}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

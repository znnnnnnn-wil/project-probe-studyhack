import React, { useState, useEffect } from "react";
import {
  ArrowRight,
  MessageSquare,
  RefreshCw,
  Check,
  ShieldCheck,
} from "lucide-react";
import { api, go, emptyProject } from "./api";
import type { Project, Training, TrainingSummary } from "./types";
import { ResumeImport } from "./resume-import";
import { Button, Loading, PageHead } from "./ui";
import type { Actions } from "./ui";
import { useMounted } from "./use-read-scope";
import { ProjectPractice } from "./project-practice";
import "./editor.css";
import { ProjectFields } from "./project-fields";

export function Editor({ id, run, busy }: Actions & { id: string }) {
  const mounted = useMounted();
  const [importBusy, setImportBusy] = useState(false);
  busy = busy || importBusy;
  const [p, setP] = useState<Project>({ ...emptyProject });
  const [loaded, setLoaded] = useState(id === "new");
  const [dirty, setDirty] = useState(false);
  const [history, setHistory] = useState<TrainingSummary[]>([]);
  const [startKey] = useState(crypto.randomUUID());
  const [startError, setStartError] = useState("");
  const [starting, setStarting] = useState(false);
  const [exerciseMode, setExerciseMode] = useState("STANDARD");
  const [difficulty, setDifficulty] = useState("IMPLEMENTATION");
  const [step, setStep] = useState<"materials" | "facts">("materials");
  const [shop, setShop] = useState<Shop | null>(null);
  const [draftNotice, setDraftNotice] = useState("");
  const [factsDirty, setFactsDirty] = useState(false);
  const [expanded, setExpanded] = useState(() => sessionStorage.getItem("project:expand:" + id) === "true");
  const draftKey = "project-draft:" + id;
  const factDraftKey = "fact-draft:" + id;
  const restore = (project: Project) => {
    const raw = sessionStorage.getItem(draftKey);
    if (raw)
      try {
        const draft = JSON.parse(raw) as Project;
        if (
          draft.version === project.version &&
          typeof draft.name === "string" &&
          typeof draft.responsibility === "string"
        ) {
          setP({ ...project, ...draft });
          setExpanded(true);
          setDirty(true);
          setDraftNotice("已恢复此标签页未保存的材料");
          return;
        }
        setDraftNotice("材料已在其他页面更新，旧草稿未覆盖新版本");
      } catch {
        sessionStorage.removeItem(draftKey);
      }
    setP(project);
  };
  useEffect(() => {
    const controller = new AbortController();
    sessionStorage.removeItem("project:expand:" + id);
    run(async () => {
      const [project, history] = await Promise.all([
        api<Project>("/projects/" + id, "GET", undefined, controller.signal),
        api<TrainingSummary[]>(
          "/trainings?summary=true&project=" + encodeURIComponent(id),
          "GET",
          undefined,
          controller.signal,
        ),
      ]);
      if (controller.signal.aborted) return;
      restore(project);
      setHistory(history);
      setLoaded(true);
    });
    return () => controller.abort();
  }, [id, run]);
  useEffect(() => {
    if (dirty) sessionStorage.setItem(draftKey, JSON.stringify(p));
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [p, dirty, draftKey]);
  const save = () =>
    run(async () => {
      const result = await api<Project>("/projects/" + id, "PUT", p);
      setP(result);
      setDirty(false);
      sessionStorage.removeItem(draftKey);
      setDraftNotice("材料已保存");
    });
  const startRetest = (parentId: string) =>
    run(async () => {
      const t = await api<Training>("/trainings", "POST", {
        projectId: id,
        parentId,
        requestKey: startKey.slice(0, 16) + "-retest-" + parentId,
      });
      if (mounted.current)
        go((t.status === "COMPLETED" ? "/report/" : "/trainings/") + t.id);
    });
  if (!loaded) return <Loading />;
  const ongoing = history.filter(
    (t) => !["COMPLETED", "REFUNDED"].includes(t.status),
  );
  const completedDeep = history.filter(
    (t) => t.kind === "DEEP" && t.status === "COMPLETED",
  );
  return (
    <section className="page editor-page">
      <PageHead
        eyebrow="项目档案"
        title={p.name}
        text={"Java 后端项目面试 · 材料版本 " + p.version}
        action={
          <Button secondary onClick={() => go("/projects")}>
            返回项目列表
          </Button>
        }
      />
      {draftNotice && (
        <p className="save-notice" role="status">
          {draftNotice}
        </p>
      )}
      <ProjectPractice
        projectId={id}
        projectName={p.name}
        roundId={roundId}
        openOnLoad={openOnLoad}
        disabled={dirty}
        run={run}
        busy={busy}
        onSaved={project => {
          setP(project);
          setDirty(false);
          sessionStorage.removeItem(draftKey);
          setDraftNotice("练习补充已保存到项目材料。");
        }}
        onEditMaterials={() => document.getElementById("project-materials")?.scrollIntoView({ block: "start" })}
      />
      <div className="editor-layout">
        <div id="project-materials" className="materials-panel">
          <div className="panel-heading">
            <h2>项目材料</h2>
          </div>
          <div className="material-guide">
            <strong>先填两项，就能开始</strong>
            <p>保存项目名称和个人职责后即可开始训练。技术栈、实现和验证细节可以按需补充。</p>
            <details>
              <summary>个人职责怎么写？查看填写参考</summary>
              <p>围绕一个你亲自参与的功能，写清做了什么、怎么做，以及哪些内容还不确定。</p>
              <blockquote>合成示例：我负责预约创建接口，用数据库唯一约束处理重复预约；登录模块由同学完成；并发正确性还没有验证。</blockquote>
              <p>请按实际经历填写。课程项目、协作任务和未验证的内容都可以如实说明。</p>
            </details>
          </div>
          <p className="material-privacy">
            <ShieldCheck size={15} />
            材料用于 AI
            提取与追问，并保存在服务端。请移除密钥、个人身份信息和无权提供的代码。
          </p>
          <ResumeImport
            disabled={busy || factsDirty}
            onBusy={setImportBusy}
            onSelect={(candidate) => {
              if (
                (p.name.trim() || p.responsibility.trim() || p.resume.trim()) &&
                !window.confirm(
                  "将用选中的简历项目替换当前材料草稿，已保存的服务器记录不会立即修改。是否继续？",
                )
              )
                return;
              setP({
                ...p,
                ...candidate,
                targetRole: candidate.targetRole || p.targetRole,
                materials: "",
                facts: [],
                factsConfirmed: false,
              });
              setDirty(true);
              setDraftNotice("已填入简历项目，请核对后保存");
            }}
          />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <ProjectFields project={p} expanded={expanded} basics={["name", "targetRole", "responsibility"]}
              onChange={(field, value) => {
                setP({ ...p, [field]: value });
                setDirty(true);
              }} />
            <button type="button" className="text-link" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
              {expanded ? "收起补充材料" : "展开技术栈、实现与验证等补充材料"}
            </button>
            <div className="form-bottom">
              <span>
                {dirty ? "有尚未保存的修改" : "材料已保存"}
              </span>
              <Button type="submit" disabled={busy}>
                保存项目材料 <Check size={16} />
              </Button>
            </div>
          </form>
        </div>
        {(ongoing.length > 0 || completedDeep.length > 0) && <aside className="training-aside">
          {ongoing.map((t) => (
            <a
              className="resume-row editor-resume"
              href={"#/trainings/" + t.id}
              key={t.id}
            >
              <MessageSquare size={18} />
              <div>
                <strong>
                  继续{t.kind === "RETEST" ? "专项复测" : "已有深挖"}
                </strong>
                <small>
                  已保存 {t.answeredCount}/{t.maxTurns} 个回答 · 不重复扣次
                </small>
              </div>
              <ArrowRight size={15} />
            </a>
          ))}
          {history
            .filter((t) => t.kind === "DEEP" && t.status === "COMPLETED")
            .map((t) => (
              <div className="retest-entry" key={t.id}>
                <RefreshCw size={22} />
                <h3>补充后，再测一次</h3>
                <p>{t.retestTopics?.join(" · ")}</p>
                {t.retestEntry?.returned &&
                  t.retestEntry.state === "AVAILABLE" && (
                    <small>上次故障复测次数已返还，可以重新开始。</small>
                  )}
                <Button
                  disabled={
                    busy ||
                    t.retestEntry?.state === "UNAVAILABLE" ||
                    (t.retestEntry?.state === "AVAILABLE" &&
                      (dirty || !p.factsConfirmed))
                  }
                  onClick={() => {
                    const entry = t.retestEntry;
                    if (entry?.trainingId)
                      go(
                        (entry.state === "COMPLETED"
                          ? "/report/"
                          : "/trainings/") + entry.trainingId,
                      );
                    else start(t.id);
                  }}
                >
                  {t.retestEntry?.state === "COMPLETED"
                    ? "查看复测结果"
                    : t.retestEntry?.state === "CONTINUE"
                      ? "继续复测"
                      : t.retestEntry?.state === "UNAVAILABLE"
                        ? "此轮暂时无法复测"
                        : "开始关联复测"}
                </Button>
                <a href={"#/report/" + t.id}>查看上次报告</a>
              </div>
            ))}
        </aside>}
      </div>
    </section>
  );
}

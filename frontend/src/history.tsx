import { useState } from "react";
import { ArrowLeft, ChevronRight, MessageSquare, RefreshCw } from "lucide-react";
import { go } from "./api";
import type { Training, TrainingSummary, ListPage } from "./types";
import { Empty, Loading, PageHead, statusLabel, Button } from "./ui";
import type { Actions } from "./ui";
import { useApiResource } from "./use-api-resource";
import { TrainingSelect } from "./training-select";
import { PracticeArchive } from "./practice-archive";
import "./history.css";

type PracticeRecord = {
  projectId: string;
  roundId: string;
  roundNumber: number;
  name: string;
  status: string;
  answeredCount: number;
  maxTurns: number;
  retestCompleted?: boolean;
  startedAt: number;
  interviewTopic: string;
  totalScore?: number | null;
  hasScoring?: boolean;
  prioritySuggestion: string;
};

function groupByProject(records: PracticeRecord[]) {
  const projects = new Map<string, PracticeRecord[]>();
  for (const record of records) {
    const rounds = projects.get(record.projectId);
    if (rounds) rounds.push(record);
    else projects.set(record.projectId, [record]);
  }
  for (const rounds of projects.values()) {
    rounds.sort((a, b) => b.roundNumber - a.roundNumber);
  }
  return projects;
}

function Transcript({ id }: { id: string }) {
  const { data, error, reload } = useApiResource<Training>("/trainings/" + id);
  if (error)
    return (
      <div role="alert">
        {error}{" "}
        <Button secondary onClick={reload}>
          重新读取问答
        </Button>
      </div>
    );
  if (!data) return <Loading />;
  return data.turns.length ? (
    <ol className="archive-turns">
      {data.turns.map((turn, index) => (
        <li key={turn.id}>
          <div className="archive-turn-heading">
            <strong>
              问题 {index + 1} · {turn.topic}
            </strong>
            {turn.answeredAt && (
              <time dateTime={new Date(turn.answeredAt).toISOString()}>
                {new Date(turn.answeredAt).toLocaleString("zh-CN")}
              </time>
            )}
          </div>
          <p className="archive-question">{turn.question}</p>
          <p className="archive-answer">{turn.answer || "尚未提交回答"}</p>
        </li>
      ))}
    </ol>
  ) : (
    <p>尚未生成问题</p>
  );
}

function HistoryRecord({ training: t }: { training: TrainingSummary }) {
  const [open, setOpen] = useState(false);
  return (
    <article className="history-record">
      <a
        className="history-link"
        href={
          "#/" +
          (t.status === "COMPLETED" ? "report" : "trainings") +
          "/" +
          t.id
        }
      >
        <div className="card-icon">
          {t.kind === "RETEST" ? <RefreshCw /> : <MessageSquare />}
        </div>
        <div>
          <h3>{t.project.name}</h3>
          <p>
            {t.kind === "RETEST" ? "专项复测" : "项目深挖"}{" "}
            {t.historyRoundNumber ? "· 第 " + t.historyRoundNumber + " 轮" : ""}
            · {new Date(t.createdAt).toLocaleString("zh-CN")} · 已回答{" "}
            {t.answeredCount} 题
          </p>
        </div>
        <span className="badge">{statusLabel[t.status]}</span>
        <ChevronRight />
      </a>
      <details
        className="archive-details"
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary>完整问答（{t.turnCount} 题）</summary>
        {open && <Transcript id={t.id} />}
      </details>
    </article>
  );
}

type HistoryProps = Actions & { projectId?: string; roundId?: string };

export function History({ busy, run, projectId, roundId }: HistoryProps) {
  const [key, setKey] = useState("");
  const [offset, setOffset] = useState(0);
  const practice = useApiResource<PracticeRecord[]>("/practice-history");
  const page = useApiResource<ListPage<TrainingSummary>>(
    "/training-page?limit=20&offset=" +
      offset +
      "&key=" +
      encodeURIComponent(key),
  );
  const choices =
    useApiResource<{ key: string; name: string }[]>("/training-projects");
  const projects = groupByProject(practice.data ?? []);
  const rounds = projectId ? projects.get(projectId) : undefined;
  const record = rounds?.find(round => round.roundId === roundId);
  const projectHistoryPath = projectId ? `#/history/${encodeURIComponent(projectId)}` : "#/history";
  if (projectId && roundId) {
    return (
      <section className="page practice-history-page">
        <a className="practice-history-back" href={projectHistoryPath}>
          <ArrowLeft size={16} aria-hidden="true" /> 返回项目训练记录
        </a>
        <div className="page-head">
          <div>
            <h1>{record ? `第 ${record.roundNumber} 次面试` : "面试记录"}</h1>
            {rounds && <p>{rounds[0].name}</p>}
          </div>
        </div>
        <PracticeArchive key={`${projectId}/${roundId}`} projectId={projectId} roundId={roundId} run={run} busy={busy} onScored={practice.reload} />
      </section>
    );
  }
  return (
    <section className="page">
      <PageHead
        eyebrow="每一步都有记录"
        title="训练记录"
        text="回看已提交的回答、复盘和专项复测，或继续尚未完成的训练。"
      />
      {practice.error && (
        <div role="alert">
          {practice.error} <Button secondary onClick={practice.reload}>重新读取项目训练</Button>
        </div>
      )}
      {!!practice.data?.length && (
        <section className="panel history-list" aria-label="项目练习">
          <h2>项目练习</h2>
          {practice.data.map(record => (
            <article className="history-record" key={record.roundId ?? record.projectId}>
              <a className="history-link" href={
                `#/projects/${record.projectId}` +
                (record.status === "COMPLETED" && record.roundId ? `?roundId=${encodeURIComponent(record.roundId)}` : "")
              }>
                <div className="card-icon"><MessageSquare /></div>
                <div>
                  <h3>{record.name}</h3>
                  <p>{record.roundNumber ? `第 ${record.roundNumber} 轮 · ` : ""}已回答 {record.answeredCount} / {record.maxTurns} 题
                    {record.retestCompleted && " · 专项复测已完成"}
                    {record.status === "COMPLETED" ? " · 查看复盘" : " · 继续训练"}
                  </p>
                </div>
                <span className="badge">{statusLabel[record.status]}</span>
                <ChevronRight />
              </a>
            </article>
          ))}
        </section>
      )}
      <div className="panel history-list">
        <TrainingSelect label="筛选训练项目" value={key} disabled={busy || !choices.data}
          onChange={value => { setKey(value); setOffset(0); }}
          options={[{ value: "", label: "全部项目" }, ...(choices.data || []).map(choice => ({ value: choice.key, label: choice.name }))]} />
        {choices.error && (
          <p role="alert">
            {choices.error}{" "}
            <Button secondary onClick={choices.reload}>
              重试项目筛选
            </Button>
          </p>
        )}
        {page.error ? (
          <div role="alert">
            {page.error}{" "}
            <Button secondary onClick={page.reload}>
              重新读取记录
            </Button>
          </div>
        ) : !page.data ? (
          <Loading />
        ) : !page.data.total && (practice.loading || practice.data?.length) ? null : !page.data.total ? (
          <Empty
            title="还没有开始训练"
            text="保存项目材料后，即可开始训练。"
            action={() => go("/projects")}
          />
        ) : (
          <>
            {page.data.items.map((training) => (
              <HistoryRecord key={training.id} training={training} />
            ))}
            <div className="action-row" aria-label="训练记录分页">
              <Button
                secondary
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - 20))}
              >
                上一页
              </Button>
              <span>
                第 {Math.floor(offset / 20) + 1} 页 · 共 {page.data.total} 条
              </span>
              <Button
                secondary
                disabled={!page.data.hasMore}
                onClick={() => setOffset(offset + 20)}
              >
                下一页
              </Button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

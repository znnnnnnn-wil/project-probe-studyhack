import { useState } from "react";
import { api } from "./api";
import { Button } from "./ui";
import type { Finding, Report } from "./types";
import type { Practice, Retest } from "./use-project-practice";

type Target = { index: number; finding: Finding; evidence: Finding["evidence"][number] };

export function PracticeRetest({
  projectId, roundId, report, retest, disabled, onChange, reload,
}: {
  projectId: string;
  roundId?: string;
  report: Report;
  retest?: Retest;
  disabled: boolean;
  onChange: (value: Practice) => void;
  reload: () => Promise<void>;
}) {
  const targets: Target[] = report.findings.flatMap((finding, index) =>
    finding.evidence.map(evidence => ({ index, finding, evidence })),
  );
  const [selected, setSelected] = useState(0);
  const [answer, setAnswer] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const target = retest
    ? targets.find(({ index, evidence }) => index === retest.findingIndex && evidence.turnId === retest.turnId)
    : targets[selected];
  if (!target) return null;
  const comparison = retest?.report?.comparisons?.[0];
  const generating = retest?.status === "GENERATING";

  async function submit(current: Target) {
    setPending(true);
    setError("");
    try {
      onChange(await api<Practice>(`/projects/${projectId}/practice/retest`, "POST", {
        findingIndex: current.index,
        turnId: current.evidence.turnId,
        answer: retest?.answer ?? answer,
        roundId,
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "复测失败，请重试");
      await reload();
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="practice-next" aria-labelledby="practice-retest-title">
      <h3 id="practice-retest-title">专项复测</h3>
      <p>选一项反馈，参考补充任务，再回答一次原问题。</p>
      {!retest && targets.length > 1 && (
        <label>
          选择复测反馈
          <select
            value={selected}
            disabled={disabled || pending}
            onChange={event => {
              setSelected(Number(event.target.value));
              setAnswer("");
              setError("");
            }}
          >
            {targets.map(({ index, finding, evidence }, position) => (
              <option key={`${index}:${evidence.turnId}`} value={position}>
                {finding.topic} · {evidence.question}
              </option>
            ))}
          </select>
        </label>
      )}
      <p><strong>{target.finding.topic}</strong> · {target.finding.task}</p>
      <h4>{target.evidence.question}</h4>
      <div className="experience-evidence-pair">
        <div><strong>初答</strong><p>{target.evidence.quote}</p></div>
        {retest && <div><strong>补答</strong><p>{retest.answer}</p></div>}
      </div>
      {retest?.status === "COMPLETED" ? (
        <div className="practice-task">
          <strong>前后对照</strong>
          <p>{comparison?.assessment || "已保留两次原回答，可以自行核对新增细节与待验证事项。"}</p>
          <small>这里比较回答中的说明，实际实现与测试结果仍需核对。</small>
        </div>
      ) : (
        <form onSubmit={event => {
          event.preventDefault();
          if (!disabled && !pending && !generating && (retest?.answer ?? answer).trim()) void submit(target);
        }}>
          {!retest && (
            <label>
              补答
              <textarea
                rows={5}
                maxLength={3000}
                placeholder="例如：测试输入：两个请求同时预约同一座位。预期结果：只写入一笔。"
                disabled={disabled || pending}
                value={answer}
                onChange={event => setAnswer(event.target.value)}
                required
              />
            </label>
          )}
          <Button type="submit" disabled={disabled || pending || generating || !(retest?.answer ?? answer).trim()}>
            {pending || generating ? "正在生成对照" : retest ? "重试生成对照" : "提交补答并对照"}
          </Button>
          {generating && <Button secondary disabled={pending} onClick={() => void reload()}>刷新复测状态</Button>}
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

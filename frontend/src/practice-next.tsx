import { useState } from "react";
import { api } from "./api";
import { Button } from "./ui";
import type { Actions } from "./ui";
import type { Project } from "./types";

export function PracticeNext({ projectId, answer, disabled, onSaved, onEditMaterials, run, busy }: Actions & {
  projectId: string; answer: string; disabled: boolean; onSaved: (project: Project) => void; onEditMaterials: () => void;
}) {
  const [project, setProject] = useState<Project | null>(null);
  const [preview, setPreview] = useState("");
  const [notice, setNotice] = useState("");
  return <section className="practice-next" aria-label="练习后的下一步">
    <h3>把刚才讲清楚的内容，带到下一轮</h3>
    <div className="action-row">
      <Button secondary disabled={busy || disabled || !answer.trim()} onClick={() => run(async () => {
        const current = await api<Project>("/projects/" + projectId);
        const text = answer.trim();
        const addition = "练习回答补充（用户自述）\n" + text;
        setProject(current);
        if (current.materials.includes(addition) || current.materials.includes("一题体验补充（用户自述，未独立验证）\n" + text)) {
          setNotice("这段回答已在项目材料中，无需重复加入。"); setPreview(""); return;
        }
        setPreview([current.materials, addition].filter(Boolean).join("\n\n")); setNotice("");
      })}>预览回答补充到材料</Button>
      <Button secondary disabled={busy || disabled} onClick={onEditMaterials}>查看项目材料</Button>
    </div>
    {preview && <div className="practice-material-preview">
      <label>项目材料补充预览<textarea rows={6} value={preview} maxLength={12000} onChange={e => setPreview(e.target.value)} /></label>
      <div className="action-row"><Button disabled={busy || disabled || !preview.trim() || preview.length > 12000} onClick={() => run(async () => {
        if (!project) return;
        const saved = await api<Project>("/projects/" + projectId, "PUT", { ...project, materials: preview });
        setPreview(""); setNotice("回答已加入项目材料。"); onSaved(saved);
      })}>确认保存回答补充</Button><Button secondary disabled={busy} onClick={() => setPreview("")}>取消补充</Button></div>
      {preview.length > 12000 && <p role="alert">补充后超过12000字，请整理后再保存。</p>}
    </div>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}

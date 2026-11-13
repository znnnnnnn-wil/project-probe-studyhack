import React, { useEffect, useState } from "react";
import { api } from "./api";
import { Button } from "./ui";
import type { Actions } from "./ui";
import type { ProjectSummary } from "./types";
import { TrainingSelect } from "./training-select";

export function PrivacyInfo() {
  return <section className="panel"><h2>隐私与服务说明</h2>
    <p>免登录示例为浏览器内的规则引导练习，不调用模型、不上传回答。进度、草稿与笔记保存在当前标签页的 sessionStorage；重新开始会清除该轮内容，浏览器关闭或清理存储后可能丢失。你可以先导出复盘自行保留。</p>
    <p>项目材料、问答、报告和已保存笔记用于训练并保存于服务端；回答草稿保留30天，简历识别缓存保留30天。原简历文件和录音不保存，识别出的文字可能成为项目或回答的一部分。</p>
    <p>登录后的项目训练将材料与问答保存于本项目后端。真实AI模式下，相关内容会发送给服务端配置的模型提供方处理；默认规则演示不请求外部模型。语音转写在配置并启用后由百炼处理。基础脱敏不能保证移除全部个人信息，请仅上传有权提供的脱敏材料。</p>
    <p>服务记录注册、材料保存、体验、训练与报告等阶段的时间和环境，用于汇总使用过程；不在阶段统计中记录材料或回答原文。成功文本用量与调用尝试用于排查服务故障和估算成本。</p>
    <p>反馈仅用于练习，不承诺技术结论完全准确或面试结果。参赛版本的免费训练为每账号一轮五题，不创建付款订单。材料在开始时保存快照，之后修改材料不自动改变已经开始的问答与复盘。</p>
    <p>删除项目会删除该项目的材料修订、问答、报告及草稿，不返还已用次数。注销将撤销登录并清理个人训练内容；支付及权益账务记录保留。历史备份副本可能仍保留，清理或恢复须由运营者核对，不能承诺即时从全部备份抹除。</p>
    <p>问题反馈可在训练页提交；账户和支付问题可在下方保存反馈及请求编号。请勿提交密码、恢复码或完整支付凭据。</p>
  </section>;
}

export function DataControls({ run, busy }: Actions) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState(""); const [confirmation, setConfirmation] = useState("");
  const [password, setPassword] = useState(""); const [notice, setNotice] = useState("");
  useEffect(() => { const controller = new AbortController();
    api<ProjectSummary[]>("/projects?summary=true", "GET", undefined, controller.signal).then(setProjects).catch(() => {});
    return () => controller.abort();
  }, []);
  return <><PrivacyInfo /><section className="panel"><h2>清理个人数据</h2>
    <Button secondary disabled={busy} onClick={() => {
      if (window.confirm("清空本账号全部简历识别缓存？已保存的项目不受影响。")) run(async () => {
        const result = await api<{ message: string }>("/account/resume-cache", "DELETE"); setNotice(result.message);
      });
    }}>清空简历识别缓存</Button>
    <TrainingSelect label="要删除的项目" value={project} onChange={value => { setProject(value); setConfirmation(""); }} disabled={busy}
      options={[{ value: "", label: "选择项目" }, ...projects.map(p => ({ value: p.id!, label: p.name }))]} />
    <label>当前密码（用于数据清理）<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
    <label>确认文字<input value={confirmation} onChange={e => setConfirmation(e.target.value)} placeholder="删除项目填完整项目名；注销填“注销账户”" /></label>
    <div className="action-row"><Button secondary disabled={busy || !project || !password || confirmation !== projects.find(p => p.id === project)?.name} onClick={() => {
      if (window.confirm("永久删除该项目及全部问答、报告和草稿？已用次数不返还。")) run(async () => {
        const result = await api<{ message: string }>("/projects/" + project, "DELETE", { password, confirmation });
        setProjects(items => items.filter(p => p.id !== project)); setProject(""); setConfirmation(""); setPassword("");
        sessionStorage.clear(); setNotice(result.message);
      });
    }}>删除所选项目及训练内容</Button>
    <Button secondary disabled={busy || !password || confirmation !== "注销账户"} onClick={() => {
      if (window.confirm("注销会清除个人训练内容并使剩余权益无法继续使用，不能自动退款。确定注销？")) run(async () => {
        await api("/account", "DELETE", { password, confirmation }); sessionStorage.clear(); location.hash = "/"; location.reload();
      });
    }}>注销账户</Button></div>
    {notice && <p role="status">{notice}</p>}
  </section></>;
}

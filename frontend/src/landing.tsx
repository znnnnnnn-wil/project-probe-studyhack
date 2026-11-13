import {
  ArrowDown,
  ArrowRight,
  BookOpen,
  Check,
  FileText,
  GitBranch,
  Quote,
  ShieldCheck,
} from "lucide-react";
import { go } from "./api";
import { samples } from "./experience-data";
import "./competition.css";

export function Home({
  onStart,
  backendReady,
}: {
  onStart: () => void;
  backendReady: boolean;
}) {
  return (
    <div className="competition-home">
      <section className="probe-hero">
        <div className="probe-hero-copy">
          <div className="probe-eyebrow">
            <span /> 从项目材料出发的面试练习
          </div>
          <h1>
            做过的项目，
            <br />
            经得起<span>下一问。</span>
          </h1>
          <p>
            从“我做过”到“我讲得清”。围绕你的职责、实现与取舍连续追问，把需要补充的地方，落回原回答和项目材料。
          </p>
          <div className="probe-hero-actions">
            <button className="button" onClick={() => go("/experience")}>
              免登录体验五轮 <ArrowRight size={17} />
            </button>
            <button
              className="probe-text-button"
              onClick={onStart}
              disabled={!backendReady}
            >
              用我的项目训练 <ArrowRight size={16} />
            </button>
          </div>
          <div className="probe-hero-note">
            <ShieldCheck size={14} /> 示例在浏览器内运行，不上传你的回答
          </div>
          {!backendReady && (
            <small>当前可体验示例；自有项目训练需连接后端服务。</small>
          )}
          <a
            className="probe-scroll"
            href="#how-it-works"
            onClick={(e) => {
              e.preventDefault();
              document
                .getElementById("how-it-works")
                ?.scrollIntoView({ behavior: "smooth" });
            }}
          >
            <ArrowDown size={15} /> 看看一次追问如何发生
          </a>
        </div>
        <div className="probe-preview" aria-label="追问流程示意">
          <div className="probe-preview-top">
            <span>
              <span className="probe-live-dot" /> 一次有依据的追问
            </span>
            <span>PREVIEW / 02</span>
          </div>
          <div className="probe-document">
            <span>
              <FileText size={15} /> 项目材料 / 校园预约系统
            </span>
            <p>“在数据库中约束同一座位、同一时段的有效预约唯一。”</p>
            <small>来源：关键实现 · 合成示例</small>
          </div>
          <div className="probe-connection">
            <GitBranch size={16} /> 从材料中的具体实现继续问
          </div>
          <div className="probe-question-preview">
            <div>
              <span className="probe-avatar">问</span>
              <strong>项目追问官</strong>
              <span>实现机制</span>
            </div>
            <h2>
              两个请求同时查到“空闲”，
              <br />
              最后由谁保证只有一笔预约？
            </h2>
            <p>把术语展开成执行顺序，讲清约束在哪里生效。</p>
          </div>
          <div className="probe-preview-bottom">
            <Check size={15} /> 有原文可核对 <span /> 没做过，可以直接说明
          </div>
        </div>
      </section>
      <section className="probe-method" id="how-it-works">
        <div className="probe-section-heading">
          <div>
            <div className="probe-eyebrow">把一次练习，变成下一步行动</div>
            <h2>材料 → 追问 → 证据复盘</h2>
          </div>
          <p>每一步都围绕你的实际项目。</p>
        </div>
        <div className="probe-method-grid">
          {[
            {
              icon: FileText,
              title: "先说清，自己做了什么",
              text: "整理简历、README 与个人职责。让问题从具体材料出发，也保留尚未验证的边界。",
            },
            {
              icon: GitBranch,
              title: "顺着回答，再往下问",
              text: "从实现走向并发、失败与取舍。示例按五个维度练习，真实模型模式结合你的回答追问。",
            },
            {
              icon: BookOpen,
              title: "回到原文，补上缺口",
              text: "保留问题、原回答和引用依据。写下补充任务，让下一次练习有所准备。",
            },
          ].map((item, i) => (
            <article key={item.title}>
              <span className="probe-step">0{i + 1}</span>
              <item.icon size={25} strokeWidth={1.5} />
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="probe-samples">
        <div className="probe-section-heading">
          <div>
            <div className="probe-eyebrow">先试一个熟悉的场景</div>
            <h2>你会怎样回答下一问？</h2>
          </div>
          <span className="probe-label">合成材料 · 本地规则演示</span>
        </div>
        <div className="probe-sample-grid">
          {samples.map((sample, index) => (
            <a key={sample.id} href={`#/experience?sample=${sample.id}`}>
              <span className="probe-sample-number">
                0{index + 1} <ArrowRight size={18} />
              </span>
              <span className="probe-label">{sample.label}</span>
              <h3>{sample.project.name}</h3>
              <p>{sample.project.problems}</p>
              <span className="probe-sample-link">
                带着这个问题，练五轮 <ArrowRight size={14} />
              </span>
            </a>
          ))}
        </div>
      </section>
      <section className="probe-closing">
        <Quote size={27} strokeWidth={1.5} />
        <h2>
          讲清楚一个真实细节，
          <br />
          比背熟十个术语更进一步。
        </h2>
        <button className="button" onClick={() => go("/experience")}>
          开始我的第一轮 <ArrowRight size={17} />
        </button>
        <p>不生成虚构经历，不承诺面试或录用结果。</p>
      </section>
    </div>
  );
}

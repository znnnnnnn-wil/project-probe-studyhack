import type { Project } from "./types";

export type MaterialField = Exclude<
  keyof Project,
  "id" | "version" | "facts" | "factsConfirmed"
>;

export const projectFields: [MaterialField, string, string][] = [
  ["name", "项目名称", "例如：校园自习室预约系统"],
  ["targetRole", "目标岗位", "例如：Java 后端实习"],
  ["stack", "技术栈", "例如：Spring Boot / PostgreSQL"],
  ["background", "项目背景与目标", "为谁解决什么问题？"],
  ["resume", "简历中的项目经历", "粘贴原文"],
  ["responsibility", "个人职责（必填）", "写清你负责的功能和做过的工作"],
  ["architecture", "架构说明", "请求经过哪些组件？数据如何流转？"],
  ["implementation", "关键实现", "选一个功能说明接口、表结构与处理步骤"],
  ["problems", "遇到的问题与方案", "当时的现象、原因、选择与取舍"],
  ["verification", "验证方式", "测试输入、预期结果和实际证据"],
  ["materials", "README / 脱敏代码片段（可选）", "仅粘贴脱敏后的相关文本"],
];

const shortFields = ["name", "targetRole", "stack"];

export function ProjectFields({
  project,
  expanded,
  basics,
  onChange,
}: {
  project: Project;
  expanded: boolean;
  basics: MaterialField[];
  onChange: (field: MaterialField, value: string) => void;
}) {
  return (
    <div className="form-fields">
      {projectFields
        .filter(([key]) => expanded || basics.includes(key))
        .map(([key, label, placeholder]) => {
          const isShort = shortFields.includes(key);
          return (
            <label key={key} className={isShort ? undefined : "wide"}>
              {label}
              {isShort ? (
                <input
                  value={project[key] ?? ""}
                  placeholder={placeholder}
                  maxLength={key === "name" ? 100 : 12000}
                  onChange={(event) => onChange(key, event.target.value)}
                  required={key === "name"}
                />
              ) : (
                <textarea
                  rows={key === "materials" ? 6 : 3}
                  value={project[key] ?? ""}
                  placeholder={placeholder}
                  maxLength={12000}
                  onChange={(event) => onChange(key, event.target.value)}
                  required={key === "responsibility"}
                />
              )}
            </label>
          );
        })}
    </div>
  );
}

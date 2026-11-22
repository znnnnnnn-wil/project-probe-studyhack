import exampleProjects from "../../backend/src/main/resources/example-projects.json" with { type: "json" };

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public requestId?: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  method = "GET",
  data?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch("/api" + path, {
    method,
    credentials: "same-origin",
    signal,
    headers: { "Content-Type": "application/json" },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(
      response.status,
      body.message ||
        ({
          401: "请先登录",
          403: "请求来源校验失败，请使用配置的访问地址",
          429: "操作过于频繁，请稍后再试",
        }[response.status] ??
          "请求失败，请稍后重试"),
      body.requestId || response.headers.get("X-Request-ID") || undefined,
    );
  }
  return response.status === 204 ||
    response.headers.get("content-length") === "0"
    ? (undefined as T)
    : await response.text().then((t) => (t ? JSON.parse(t) : undefined));
}
export const go = (path: string) => {
  location.hash = path;
};
export async function upload<T>(
  path: string,
  file: Blob,
  filename: string,
  extra: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<T> {
  const data = new FormData();
  data.append("file", file, filename);
  for (const [key, value] of Object.entries(extra)) data.append(key, value);
  const response = await fetch("/api" + path, {
    method: "POST",
    credentials: "same-origin",
    body: data,
    signal,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(
      response.status,
      body.message ||
        (response.status === 413
          ? "文件过大，请缩小后再上传"
          : response.status === 401
            ? "登录已过期，请重新登录"
            : "识别失败，请稍后重试"),
    );
  return body as T;
}
export const emptyProject = {
  name: "",
  background: "",
  targetRole: "Java 后端实习",
  stack: "",
  responsibility: "",
  resume: "",
  architecture: "",
  implementation: "",
  problems: "",
  verification: "",
  materials: "",
  facts: [],
  factsConfirmed: false,
};
export const demoProject = {
  ...emptyProject,
  ...exampleProjects[0].project,
};

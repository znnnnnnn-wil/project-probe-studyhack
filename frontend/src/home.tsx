import React, { useState } from "react";
import { ArrowRight } from "lucide-react";
import { api } from "./api";
import { Button } from "./ui";
import type { Actions } from "./ui";
import { RecoverLogin } from "./account";
export function Login({
  run,
  busy,
  onLogin,
}: Actions & { onLogin: (u: { id: string; username: string }) => void }) {
  const [register, setRegister] = useState(true);
  const [recover, setRecover] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  if (recover) return <section className="page"><RecoverLogin run={run} busy={busy} onBack={() => { setRecover(false); setRegister(false); }} /></section>;
  return (
    <section className="auth-layout">
      <div>
        <div className="eyebrow">从你的项目开始</div>
        <h1>
          给下一次面试，
          <br />
          <span>多一点准备。</span>
        </h1>
        <p>
          注册后，项目材料、回答和复盘将保存在服务端。
          <br />
          请使用合成或脱敏材料，不要填写密钥、手机号等敏感信息。
        </p>
      </div>
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () =>
            onLogin(
              await api("/auth/" + (register ? "register" : "login"), "POST", {
                username: name,
                password,
              }),
            ),
          );
        }}
      >
        <h2>{register ? "创建练习账号" : "欢迎回来"}</h2>
        {!register && <button type="button" className="text-link" onClick={() => setRecover(true)}>忘记密码？使用恢复码</button>}
        <p>注册后可用自己的项目免费训练五轮。请到「账户与数据」生成并保存恢复码，未保存恢复码时无法自助找回密码。</p>
        <label>
          用户名
          <input
            autoComplete="username"
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <label>
          密码
          <input
            type="password"
            autoComplete={register ? "new-password" : "current-password"}
            minLength={10}
            maxLength={72}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="至少 10 个字符"
            required
          />
        </label>
        <Button type="submit" disabled={busy}>
          {register ? "注册并开始" : "登录"}
          <ArrowRight size={17} />
        </Button>
        <button
          type="button"
          className="text-link"
          onClick={() => setRegister(!register)}
        >
          {register ? "已有账号？去登录" : "没有账号？创建一个"}
        </button>
      </form>
    </section>
  );
}

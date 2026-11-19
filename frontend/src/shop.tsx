import React, { useState, useEffect, useCallback } from "react";
import {
  ArrowRight,
  FolderOpen,
  RefreshCw,
  Check,
  ShieldCheck,
  X,
  CreditCard,
} from "lucide-react";
import { api, go } from "./api";
import type { Shop, Order } from "./types";
import { paymentLabel, openPaymentWindow, orderLabel } from "./payment";
import { usePaymentCheckout } from "./payment-checkout";
import { purchaseProject } from "./workspace";
import { trainingQuota } from "./quota";
import { Button, Loading, Empty, PageHead } from "./ui";
import type { Actions } from "./ui";
import { useReadScope } from "./use-read-scope";

export function PaymentReturn({
  run,
  busy,
  mode,
  configured,
}: Actions & { mode: string; configured: boolean }) {
  const id = new URLSearchParams(location.search).get("probe_order") || "";
  const [order, setOrder] = useState<Order | null>(null);
  const originProject = purchaseProject(id);
  const beginRead = useReadScope();
  const load = useCallback(async () => {
    const read = beginRead();
    const current = await api<Order>(
      "/orders/" + id,
      "GET",
      undefined,
      read.signal,
    );
    if (!read.current()) return;
    setOrder(current);
    if (
      (current.status === "PENDING" || current.status === "EXPIRED") &&
      current.mode === mode &&
      current.can_operate !== false &&
      mode !== "mock" &&
      configured
    ) {
      try {
        const confirmed = await api<Order>("/orders/" + id + "/sync", "POST");
        if (read.current()) setOrder(confirmed);
      } catch (e) {
        if (!read.current()) return;
        const saved = await api<Order>(
          "/orders/" + id,
          "GET",
          undefined,
          read.signal,
        );
        if (read.current()) setOrder(saved);
        throw e;
      }
    }
  }, [id, mode, configured, beginRead]);
  useEffect(() => {
    if (/^[a-f0-9-]{36}$/.test(id))
      run(async () => {
        await load();
      });
  }, [id, run, load]);
  useEffect(() => {
    if (order?.status !== "PAID") return;
    sessionStorage.removeItem("payment:waiting");
    const timer = window.setTimeout(() => {
      location.replace(
        "/#" + (originProject ? "/projects/" + originProject : "/shop"),
      );
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [order?.status, originProject]);
  useEffect(() => {
    if (!order || !["PENDING", "EXPIRED"].includes(order.status)) return;
    const timer = window.setTimeout(() => {
      void load().catch(() => {});
    }, 15000);
    return () => window.clearTimeout(timer);
  }, [order, load]);
  if (!/^[a-f0-9-]{36}$/.test(id))
    return (
      <Empty
        title="未找到待核对订单"
        text="返回订单页选择订单。跳转参数不能证明付款成功。"
        action={() => go("/shop")}
      />
    );
  return (
    <section className="page">
      <PageHead
        eyebrow="支付结果核对"
        title={order ? orderLabel(order) : "正在读取订单…"}
        text="此页以服务端通知或查询结果为准。返回到本页不代表付款成功，不会依据跳转参数发放次数。"
      />
      <div className="panel">
        {order && (
          <>
            <span className="badge">{paymentLabel[order.mode]}</span>
            <p>订单金额 ¥{(order.amount_cents / 100).toFixed(2)}</p>
            <small>{order.id}</small>
            {order.query_error && <p>{order.query_error}</p>}
            {order.can_operate === false && (
              <p>该订单属于历史支付环境或账号，当前环境不能查询或支付。</p>
            )}
          </>
        )}
        {order?.status === "PAID" && (
          <div className="payment-delivered">
            <Check size={28} />
            <h2>训练包已交付</h2>
            <p>
              {order.lifetime
                ? "永久训练权益已开通。"
                : order.product_code === "TEN_TRAININGS"
                  ? "深挖与复测合计 10 次已到账。"
                  : "1 次深挖 + 1 次关联复测已到账。"}
              现在可以继续准备项目。
            </p>
            <Button
              onClick={() =>
                go(originProject ? "/projects/" + originProject : "/projects")
              }
            >
              {originProject ? "返回原项目开始练习" : "前往我的项目"}
              <ArrowRight size={16} />
            </Button>
          </div>
        )}
        <p>
          <Button
            secondary
            disabled={busy}
            onClick={() =>
              run(async () => {
                await load();
              })
            }
          >
            重新查询订单状态
          </Button>
        </p>
        <a href="#/shop">返回训练包与订单</a>
      </div>
    </section>
  );
}
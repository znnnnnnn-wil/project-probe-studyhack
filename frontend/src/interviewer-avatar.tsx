import React, { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { loadInterviewerRig, type AvatarState } from "./interviewer-rig";
import type { FacePresence } from "./use-face-presence";
import "./interviewer.css";

const PORTRAIT_URL = "/models/interviewer-portrait.webp";

export function InterviewerAvatar({
  state = "idle",
  label = "虚拟面试官陈老师",
  mouthLevel,
  presence,
}: {
  state?: AvatarState;
  label?: string;
  mouthLevel?: { current: number };
  presence?: { current: FacePresence };
}) {
  const mount = useRef<HTMLDivElement>(null);
  const latest = useRef({ state, mouthLevel, presence });
  latest.current = { state, mouthLevel, presence };
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const host = mount.current;
    if (!host) return;
    let disposed = false;
    const cleanups: (() => void)[] = [];
    void (async () => {
      const THREE = await import("three");
      if (disposed) return;
      const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
      cleanups.push(() => {
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.1;
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(31, 1, 0.01, 100);
      scene.add(new THREE.HemisphereLight(0xf5f8ff, 0x657b96, 2.2));
      const key = new THREE.DirectionalLight(0xfff0df, 3.2);
      key.position.set(-2, 3, 4);
      scene.add(key);
      const fill = new THREE.DirectionalLight(0xeaf6ff, 1.7);
      fill.position.set(3, 2, 2);
      scene.add(fill);
      const rim = new THREE.DirectionalLight(0xd9e6f2, 1.2);
      rim.position.set(0, 3, -2);
      scene.add(rim);

      const rig = await loadInterviewerRig();
      if (disposed) {
        rig.dispose();
        return;
      }
      cleanups.push(rig.dispose);
      scene.add(rig.root);
      host.append(renderer.domElement);
      const resize = () => {
        const width = host.clientWidth;
        const height = host.clientHeight;
        if (!width || !height) return;
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        const distance = width < 280 ? 1.41 : 1.26;
        camera.position.set(rig.headPosition.x, rig.headPosition.y - 0.025, rig.headPosition.z + distance);
        camera.lookAt(rig.headPosition.x, rig.headPosition.y - 0.09, rig.headPosition.z);
        camera.updateProjectionMatrix();
        if (reduceMotion) renderer.render(scene, camera);
      };
      const observer = new ResizeObserver(resize);
      observer.observe(host);
      cleanups.push(() => observer.disconnect());
      resize();

      const input = () => {
        const current = latest.current;
        return {
          state: current.state,
          mouthLevel: current.mouthLevel?.current ?? -1,
          presence: current.presence?.current,
        };
      };
      if (reduceMotion) {
        rig.update({ ...input(), time: 0, dt: 0.016 });
        renderer.render(scene, camera);
      } else {
        let visible = true;
        const visibility = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
        visibility.observe(host);
        cleanups.push(() => visibility.disconnect());
        const started = performance.now();
        let previous = started;
        let frame = 0;
        const animate = (now: number) => {
          frame = requestAnimationFrame(animate);
          if (document.hidden || !visible || !host.isConnected) return;
          const dt = Math.min(0.05, (now - previous) / 1000);
          if (dt < 1 / 40) return;
          previous = now;
          rig.update({ ...input(), time: (now - started) / 1000, dt });
          renderer.render(scene, camera);
        };
        frame = requestAnimationFrame(animate);
        cleanups.push(() => cancelAnimationFrame(frame));
      }
      if (!disposed) setStatus("ready");
    })().catch(error => {
      console.error("Interviewer avatar:", error);
      if (!disposed) setStatus("error");
    });
    return () => {
      disposed = true;
      cleanups.forEach(fn => fn());
    };
  }, []);

  return (
    <div className="avatar-shell" role="img" aria-label={label}>
      <img
        className={status === "ready" ? "avatar-portrait is-hidden" : "avatar-portrait"}
        src={PORTRAIT_URL}
        alt=""
      />
      <div className={status === "ready" ? "avatar-mount is-ready" : "avatar-mount"} ref={mount} />
      {status === "loading" && (
        <div className="avatar-loading" role="status">
          <LoaderCircle className="spin" size={16} />
          正在准备 3D 面试官
        </div>
      )}
    </div>
  );
}
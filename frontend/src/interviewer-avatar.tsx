import React, { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import type { FacePresence } from "./use-face-presence";
import "./interviewer.css";

export type AvatarState = "idle" | "listening" | "speaking";

const MODEL_URL = "/models/interviewer.glb";

export function InterviewerAvatar({
  state = "idle",
  label = "3D 面试官陈老师",
  mouthLevel,
  presence,
}: {
  state?: AvatarState;
  label?: string;
  mouthLevel?: { current: number };
  presence?: { current: FacePresence };
}) {
  const mount = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const levelRef = useRef(mouthLevel);
  levelRef.current = mouthLevel;
  const presenceRef = useRef(presence);
  presenceRef.current = presence;
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  useEffect(() => {
    const host = mount.current;
    if (!host) return;
    let disposed = false;
    const cleanups: (() => void)[] = [];
    void (async () => {
      const THREE = await import("three");
      const { GLTFLoader } = await import(
        "three/addons/loaders/GLTFLoader.js"
      );
      if (disposed) return;
      const reduceMotion = matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      const renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: "low-power",
      });
      cleanups.push(() => {
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.12;
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(31, 1, 0.01, 100);
      scene.add(new THREE.HemisphereLight(0xf5f8ff, 0x657b96, 2.35));
      const key = new THREE.DirectionalLight(0xfff0df, 3.4);
      key.position.set(-2, 3, 4);
      scene.add(key);
      const fill = new THREE.DirectionalLight(0xeaf6ff, 1.8);
      fill.position.set(3, 2, 2);
      scene.add(fill);
      const rim = new THREE.DirectionalLight(0xe5edcc, 2.2);
      rim.position.set(0, 3, -2);
      scene.add(rim);

      const disposeObject = (root: import("three").Object3D) => {
        root.traverse((object) => {
          const mesh = object as import("three").Mesh;
          if (!mesh.isMesh) return;
          mesh.geometry?.dispose();
          const materials = Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material];
          for (const material of materials) {
            if (!material) continue;
            for (const value of Object.values(material)) {
              if (value && (value as import("three").Texture).isTexture)
                (value as import("three").Texture).dispose();
            }
            material.dispose();
          }
        });
      };

      const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
      if (disposed) {
        disposeObject(gltf.scene);
        return;
      }
      cleanups.push(() => disposeObject(gltf.scene));
      const model = gltf.scene;
      model.updateMatrixWorld(true);
      for (const side of ["Left", "Right"]) {
        const upperArm = model.getObjectByName(`${side}Arm`);
        const forearm = model.getObjectByName(`${side}ForeArm`);
        if (!upperArm || !forearm) continue;
        const shoulder = upperArm.getWorldPosition(new THREE.Vector3());
        const elbow = forearm.getWorldPosition(new THREE.Vector3());
        const currentDirection = elbow.sub(shoulder).normalize();
        const relaxedDirection = new THREE.Vector3(
          Math.sign(currentDirection.x) * 0.18,
          -1,
          0.12,
        ).normalize();
        const adjustment = new THREE.Quaternion().setFromUnitVectors(
          currentDirection,
          relaxedDirection,
        );
        const parentWorld = upperArm.parent!.getWorldQuaternion(
          new THREE.Quaternion(),
        );
        const armWorld = upperArm.getWorldQuaternion(new THREE.Quaternion());
        upperArm.quaternion.copy(
          parentWorld.invert().multiply(adjustment).multiply(armWorld),
        );
        upperArm.updateWorldMatrix(false, true);
      }
      model.traverse((object) => {
        const mesh = object as import("three").Mesh;
        if (!mesh.isMesh) return;
        mesh.frustumCulled = false;
        const materials = Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material];
        for (const material of materials) {
          if (
            material &&
            /hair|eyebrow|eyelash/i.test(mesh.name + " " + material.name)
          ) {
            material.transparent = true;
            material.alphaTest = 0.04;
            material.depthWrite = true;
            material.side = THREE.DoubleSide;
          }
        }
      });
      scene.add(model);
      const head = model.getObjectByName("Head");
      const neck = model.getObjectByName("Neck");
      const headPosition = new THREE.Vector3();
      if (head) head.getWorldPosition(headPosition);
      else {
        const box = new THREE.Box3().setFromObject(model);
        headPosition.set(0, box.max.y - 0.12, 0);
      }
      const originalHeadRotation = head?.rotation.clone();
      const originalNeckRotation = neck?.rotation.clone();
      const morphMeshes: import("three").Mesh[] = [];
      model.traverse((object) => {
        const mesh = object as import("three").Mesh;
        if (mesh.isMesh && mesh.morphTargetDictionary && mesh.morphTargetInfluences)
          morphMeshes.push(mesh);
      });
      host.append(renderer.domElement);
      const resize = () => {
        const width = host.clientWidth;
        const height = host.clientHeight;
        if (!width || !height) return;
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        const distance = width < 280 ? 1.41 : 1.26;
        camera.position.set(
          headPosition.x,
          headPosition.y - 0.025,
          headPosition.z + distance,
        );
        camera.lookAt(headPosition.x, headPosition.y - 0.09, headPosition.z);
        camera.updateProjectionMatrix();
      };
      const observer = new ResizeObserver(resize);
      observer.observe(host);
      cleanups.push(() => observer.disconnect());
      resize();

      let blinkStart = 2.4;
      const clock = new THREE.Clock();
      let previousTime = 0;
      let frame = 0;
      const morph = (name: string, value: number) => {
        for (const mesh of morphMeshes) {
          const index = mesh.morphTargetDictionary![name];
          if (index !== undefined) mesh.morphTargetInfluences![index] = value;
        }
      };
      const animate = () => {
        frame = requestAnimationFrame(animate);
        if (!host.isConnected || document.hidden) return;
        const time = clock.getElapsedTime();
        if (time - previousTime < 1 / 35) return;
        previousTime = time;
        const mode = stateRef.current;
        const speaking = mode === "speaking";
        const seen = presenceRef.current?.current;
        const engaged = !!seen?.ready && seen.face;
        const userSpeaking = !!seen?.speaking;
        const sway = engaged ? 0.35 : 1;
        let nod = 0;
        if (seen?.nodAt) {
          const age = (performance.now() - seen.nodAt) / 1000;
          if (age >= 0 && age < 0.9)
            nod = Math.sin((age / 0.9) * Math.PI * 2) * 0.06 * (1 - age / 0.9);
        }
        if (!reduceMotion) {
          if (head && originalHeadRotation) {
            head.rotation.x =
              originalHeadRotation.x +
              Math.sin(time * 0.65) * 0.012 * sway +
              (mode === "listening" ? Math.sin(time * 1.1) * 0.009 : 0) +
              nod +
              (userSpeaking ? 0.02 : 0);
            head.rotation.y =
              originalHeadRotation.y +
              Math.sin(time * 0.38) * 0.024 * sway +
              (engaged
                ? Math.max(-0.35, Math.min(0.35, -seen!.yaw)) * 0.12
                : 0);
            head.rotation.z =
              originalHeadRotation.z + Math.sin(time * 0.47) * 0.008 * sway;
          }
          if (neck && originalNeckRotation)
            neck.rotation.x =
              originalNeckRotation.x +
              Math.sin(time * 0.7) * 0.004 +
              (userSpeaking ? 0.015 : 0);
          const blinkProgress = time - blinkStart;
          let blink = 0;
          if (blinkProgress >= 0 && blinkProgress < 0.19)
            blink = Math.sin((blinkProgress / 0.19) * Math.PI);
          if (blinkProgress > 0.19)
            blinkStart = time + 2.7 + Math.random() * 3.5;
          morph("eyeBlinkLeft", blink);
          morph("eyeBlinkRight", blink);
        }
        const levelSource = levelRef.current;
        const audioDriven = !!levelSource && levelSource.current >= 0;
        const mouth = speaking
          ? audioDriven
            ? Math.min(1, Math.max(0, levelSource!.current)) * 0.55
            : Math.max(0, Math.sin(time * 19)) * 0.22 +
              Math.max(0, Math.sin(time * 11)) * 0.12
          : 0;
        morph("jawOpen", mouth * 0.65);
        morph("viseme_aa", mouth);
        morph(
          "viseme_O",
          speaking
            ? audioDriven
              ? mouth * 0.35
              : Math.max(0, Math.sin(time * 8)) * 0.12
            : 0,
        );
        renderer.render(scene, camera);
      };
      animate();
      cleanups.push(() => cancelAnimationFrame(frame));
      if (!disposed) setStatus("ready");
    })().catch((error) => {
      console.error("Interviewer avatar:", error);
      if (!disposed) setStatus("error");
    });
    return () => {
      disposed = true;
      cleanups.forEach((fn) => fn());
    };
  }, []);
  return (
    <div className="avatar-shell" role="img" aria-label={label}>
      <div className="avatar-mount" ref={mount} />
      {status === "loading" && (
        <div className="avatar-loading" role="status">
          <LoaderCircle className="spin" size={16} />
          正在准备 3D 面试官
        </div>
      )}
      {status === "error" && (
        <div className="avatar-loading">
          <span>3D 面试官暂不可用，可继续文字训练。</span>
        </div>
      )}
    </div>
  );
}
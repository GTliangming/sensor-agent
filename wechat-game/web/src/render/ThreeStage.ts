import * as THREE from "three";
import type { ItemConfig, LevelConfig, SceneConfig } from "../core/types";
import { DESIGN_HEIGHT, DESIGN_WIDTH, SCENE_RECT } from "../layout";
import { isOpaqueAt, itemTexture, labelTexture } from "./sprites";

// Three.js 渲染层：只负责画面和点击拾取，玩法状态全部在 GameSession。
// 正交相机直接使用设计坐标（0..1080 × 0..1920，原点左下角）。

interface Tween {
  mesh: THREE.Mesh;
  duration: number;
  elapsed: number;
  update: (t: number) => void;
  onDone?: () => void;
}

const BLOCKED_TINT = new THREE.Color(0.48, 0.48, 0.5);
const NORMAL_TINT = new THREE.Color(1, 1, 1);
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export class ThreeStage {
  onItemClick: (instanceId: string) => void = () => {};
  onTick: (dt: number) => void = () => {};

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(0, DESIGN_WIDTH, DESIGN_HEIGHT, 0, 0.1, 2000);
  private root = new THREE.Group();
  private meshes = new Map<string, THREE.Mesh>();
  private tweens: Tween[] = [];
  private hintId: string | null = null;
  private raycaster = new THREE.Raycaster();
  private clock = new THREE.Clock();
  private frame = 0;
  private resizeObserver: ResizeObserver;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color("#f4efe6");
    // 相机放在所有物件前方（物件 z 在 0..500），否则拾取射线从物件后面出发打不中
    this.camera.position.z = 1000;
    this.scene.add(this.root);
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.addEventListener("pointerdown", this.handlePointer);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.loop();
  }

  private resize() {
    const { clientWidth, clientHeight } = this.container;
    this.renderer.setSize(clientWidth, clientHeight);
  }

  private loop = () => {
    this.frame = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.onTick(dt);
    this.stepTweens(dt);
    this.animateHint();
    this.renderer.render(this.scene, this.camera);
  };

  private stepTweens(dt: number) {
    for (const tw of [...this.tweens]) {
      tw.elapsed += dt;
      const t = Math.min(tw.elapsed / tw.duration, 1);
      tw.update(t);
      if (t >= 1) {
        this.tweens = this.tweens.filter((x) => x !== tw);
        tw.onDone?.();
      }
    }
  }

  private animateHint() {
    const mesh = this.hintId ? this.meshes.get(this.hintId) : undefined;
    if (!mesh || !mesh.visible) return;
    const pulse = 1 + 0.12 * Math.sin(this.clock.elapsedTime * 10);
    mesh.scale.setScalar(pulse * (mesh.userData.baseScale as number));
  }
  loadLevel(level: LevelConfig, sceneConfig: SceneConfig, items: Map<string, ItemConfig>) {
    this.clearRoot();
    this.buildBackdrop(sceneConfig);
    level.itemInstances.forEach((inst, order) => {
      const item = items.get(inst.itemId)!;
      const size = item.size.width * inst.scale;
      const material = new THREE.MeshBasicMaterial({
        map: itemTexture(item),
        transparent: true,
        color: NORMAL_TINT.clone(),
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material);
      mesh.position.set(inst.position.x, inst.position.y, 10 + inst.layer * 10 + order * 0.01);
      mesh.rotation.z = THREE.MathUtils.degToRad(inst.rotation);
      mesh.userData = { instanceId: inst.id, interactive: true, baseScale: 1 };
      this.root.add(mesh);
      this.meshes.set(inst.id, mesh);
    });
  }

  private plane(w: number, h: number, x: number, y: number, z: number, material: THREE.Material) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
    mesh.position.set(x + w / 2, y + h / 2, z);
    this.root.add(mesh);
    return mesh;
  }

  /** 物品区是一整块底板，所有物件堆在上面 */
  private buildBackdrop(sceneConfig: SceneConfig) {
    const { x, y, width, height } = SCENE_RECT;
    this.scene.background = new THREE.Color(sceneConfig.background);
    const pad = 18;
    this.plane(width + pad * 2, height + pad * 2, x - pad, y - pad - 8, 0, new THREE.MeshBasicMaterial({ color: "#8f7a63" }));
    this.plane(width + pad * 2, height + pad * 2, x - pad, y - pad, 0.2, new THREE.MeshBasicMaterial({ color: sceneConfig.surfaceColor }));
    const label = new THREE.MeshBasicMaterial({ map: labelTexture(sceneConfig.name, "rgba(255,255,255,0.35)"), transparent: true });
    this.plane(512, 96, x + width / 2 - 256, y + height / 2 - 48, 0.4, label);
  }

  private clearRoot() {
    this.tweens = [];
    this.hintId = null;
    this.meshes.clear();
    for (const child of [...this.root.children]) {
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material as THREE.MeshBasicMaterial;
      // 物件贴图有全局缓存，只释放家具标签这类一次性贴图
      if (material?.map && !mesh.userData.instanceId) material.map.dispose();
      material?.dispose();
      this.root.remove(child);
    }
  }

  private handlePointer = (event: PointerEvent) => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const id = this.pickAt(ndc);
    if (id) this.onItemClick(id);
  };

  /** 从上往下找第一个点在图标本体上的物件，透明区域不拦截下面的物件 */
  private pickAt(ndc: THREE.Vector2): string | null {
    this.raycaster.setFromCamera(ndc, this.camera);
    const candidates = [...this.meshes.values()].filter((m) => m.visible && m.userData.interactive);
    const hit = this.raycaster.intersectObjects(candidates, false).find((h) => {
      const map = ((h.object as THREE.Mesh).material as THREE.MeshBasicMaterial).map;
      return !map || !h.uv || isOpaqueAt(map, h.uv.x, h.uv.y);
    });
    return hit ? (hit.object.userData.instanceId as string) : null;
  }

  /** 自动化测试用：找到一个点下去确实会命中该物件的屏幕坐标（CSS 像素） */
  findTapPoint(instanceId: string): { x: number; y: number } | null {
    const mesh = this.meshes.get(instanceId);
    if (!mesh || !mesh.visible) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const size = (mesh.geometry as THREE.PlaneGeometry).parameters.width;
    for (let i = 0; i < 9; i++) {
      for (let j = 0; j < 9; j++) {
        const local = new THREE.Vector3(((i + 0.5) / 9 - 0.5) * size, ((j + 0.5) / 9 - 0.5) * size, 0);
        const ndc = mesh.localToWorld(local).project(this.camera);
        if (this.pickAt(new THREE.Vector2(ndc.x, ndc.y)) === instanceId) {
          return {
            x: rect.left + ((ndc.x + 1) / 2) * rect.width,
            y: rect.top + ((1 - ndc.y) / 2) * rect.height,
          };
        }
      }
    }
    return null;
  }

  /** 被遮挡物件统一压暗（不透明度效果由程序处理，美术无需出暗化图） */
  setBlocked(instanceId: string, blocked: boolean, animate = false) {
    const mesh = this.meshes.get(instanceId);
    if (!mesh) return;
    const material = mesh.material as THREE.MeshBasicMaterial;
    material.color.copy(blocked ? BLOCKED_TINT : NORMAL_TINT);
    if (animate && !blocked) {
      this.addTween(mesh, 0.25, (t) => mesh.scale.setScalar(1 + 0.12 * Math.sin(t * Math.PI)));
    }
  }

  /** 物件飞向 HUD 格子（设计坐标），结束后从场景隐藏 */
  flyTo(instanceId: string, target: { x: number; y: number }, endScale: number, onDone?: () => void) {
    const mesh = this.meshes.get(instanceId);
    if (!mesh) return;
    if (this.hintId === instanceId) this.hintId = null;
    mesh.userData.interactive = false;
    const from = mesh.position.clone();
    const fromRotation = mesh.rotation.z;
    mesh.position.z = 500;
    const lift = 120;
    this.addTween(mesh, 0.45, (t) => {
      const e = easeInOut(t);
      mesh.position.x = from.x + (target.x - from.x) * e;
      mesh.position.y = from.y + (target.y - from.y) * e + Math.sin(e * Math.PI) * lift;
      mesh.rotation.z = fromRotation * (1 - e);
      mesh.scale.setScalar(1 + (endScale - 1) * e + 0.15 * Math.sin(e * Math.PI));
    }, () => {
      mesh.visible = false;
      onDone?.();
    });
  }

  /** 点击被遮挡物件时的抖动反馈 */
  shake(instanceId: string) {
    const mesh = this.meshes.get(instanceId);
    if (!mesh || this.tweens.some((tw) => tw.mesh === mesh)) return;
    const x = mesh.position.x;
    this.addTween(mesh, 0.3, (t) => {
      mesh.position.x = x + Math.sin(t * Math.PI * 6) * 10 * (1 - t);
    });
  }

  setHint(instanceId: string | null) {
    if (this.hintId === instanceId) return;
    const prev = this.hintId ? this.meshes.get(this.hintId) : undefined;
    if (prev && prev.userData.interactive) prev.scale.setScalar(1);
    this.hintId = instanceId;
  }

  private addTween(mesh: THREE.Mesh, duration: number, update: (t: number) => void, onDone?: () => void) {
    this.tweens.push({ mesh, duration, elapsed: 0, update, onDone });
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener("pointerdown", this.handlePointer);
    this.clearRoot();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

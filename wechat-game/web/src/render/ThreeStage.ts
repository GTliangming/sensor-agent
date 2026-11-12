import * as THREE from "three";
import type { ItemConfig, LevelConfig, SceneConfig } from "../core/types";
import { DESIGN_WIDTH, computeLayout, type StageLayout } from "../layout";
import { isItemHitAt, itemTexture, labelTexture } from "./sprites";

// Three.js 渲染层：只负责画面和点击拾取，玩法状态全部在 GameSession。
// 正交相机直接使用设计坐标（宽 1080，高随屏幕比例变化，原点左下角）。
// 只在画面有变化时重绘（动画、提示闪烁、状态变化、贴图加载完成），静止时不耗电。

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
  private camera = new THREE.OrthographicCamera(0, DESIGN_WIDTH, 1920, 0, 0.1, 2000);
  /** 物品区底板 */
  private backdrop = new THREE.Group();
  /** 物件，整体按 layout.pileOffsetY 平移 */
  private pile = new THREE.Group();
  private meshes = new Map<string, THREE.Mesh>();
  private tweens: Tween[] = [];
  private hintId: string | null = null;
  private raycaster = new THREE.Raycaster();
  private clock = new THREE.Clock();
  private frame = 0;
  private dirty = true;
  private layout: StageLayout = computeLayout();
  private sceneConfig: SceneConfig | null = null;
  private resizeObserver: ResizeObserver;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color("#f4efe6");
    // 相机放在所有物件前方（物件 z 在 0..500），否则拾取射线从物件后面出发打不中
    this.camera.position.z = 1000;
    this.scene.add(this.backdrop, this.pile);
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.addEventListener("pointerdown", this.handlePointer);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.loop();
  }

  /** 标记需要重绘 */
  invalidate = () => {
    this.dirty = true;
  };

  private resize() {
    const { clientWidth, clientHeight } = this.container;
    this.renderer.setSize(clientWidth, clientHeight);
    this.invalidate();
  }

  /** 布局变化（屏幕比例、安全区）时调用 */
  setLayout(layout: StageLayout) {
    this.layout = layout;
    this.camera.top = layout.height;
    this.camera.updateProjectionMatrix();
    // 物品堆整体等比缩放 + 平移，遮挡关系不变
    this.pile.scale.setScalar(layout.pile.scale);
    this.pile.position.set(layout.pile.offsetX, layout.pile.offsetY, 0);
    if (this.sceneConfig) this.buildBackdrop(this.sceneConfig);
    this.invalidate();
  }

  private loop = () => {
    this.frame = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.onTick(dt);
    const animating = this.tweens.length > 0 || this.hintId !== null;
    this.stepTweens(dt);
    this.animateHint();
    if (animating || this.dirty) {
      this.renderer.render(this.scene, this.camera);
      this.dirty = false;
    }
  };

  private stepTweens(dt: number) {
    for (const tw of [...this.tweens]) {
      tw.elapsed += dt;
      const t = Math.min(tw.elapsed / tw.duration, 1);
      tw.update(t);
      if (t >= 1) {
        this.tweens = this.tweens.filter((x) => x !== tw);
        tw.onDone?.();
        this.invalidate();
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
    this.clearPile();
    this.sceneConfig = sceneConfig;
    this.buildBackdrop(sceneConfig);
    level.itemInstances.forEach((inst, order) => {
      const item = items.get(inst.itemId)!;
      const size = item.size.width * inst.scale;
      const material = new THREE.MeshBasicMaterial({
        map: itemTexture(inst.itemId, inst.variantId, this.invalidate),
        transparent: true,
        color: NORMAL_TINT.clone(),
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material);
      mesh.position.set(inst.position.x, inst.position.y, 10 + inst.layer * 10 + order * 0.01);
      mesh.rotation.z = THREE.MathUtils.degToRad(inst.rotation);
      mesh.userData = { instanceId: inst.id, itemId: inst.itemId, interactive: true, baseScale: 1 };
      this.pile.add(mesh);
      this.meshes.set(inst.id, mesh);
    });
    this.invalidate();
  }

  private plane(group: THREE.Group, w: number, h: number, x: number, y: number, z: number, material: THREE.Material) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
    mesh.position.set(x + w / 2, y + h / 2, z);
    group.add(mesh);
    return mesh;
  }

  /** 物品区是一整块底板，所有物件堆在上面；底板随布局铺满物品区 */
  private buildBackdrop(sceneConfig: SceneConfig) {
    disposeChildren(this.backdrop, true);
    const { x, y, width, height } = this.layout.board;
    this.scene.background = new THREE.Color(sceneConfig.background);
    this.plane(this.backdrop, width, height, x, y - 8, 0, new THREE.MeshBasicMaterial({ color: "#8f7a63" }));
    this.plane(this.backdrop, width, height, x, y, 0.2, new THREE.MeshBasicMaterial({ color: sceneConfig.surfaceColor }));
    const label = new THREE.MeshBasicMaterial({ map: labelTexture(sceneConfig.name, "rgba(255,255,255,0.35)"), transparent: true });
    this.plane(this.backdrop, 512, 96, x + width / 2 - 256, y + height / 2 - 48, 0.4, label);
  }

  private clearPile() {
    this.tweens = [];
    this.hintId = null;
    this.meshes.clear();
    // 物件贴图有全局缓存，不随关卡释放
    disposeChildren(this.pile, false);
  }

  private handlePointer = (event: PointerEvent) => {
    const id = this.pickAtClient(event.clientX, event.clientY);
    if (id) this.onItemClick(id);
  };

  /** 屏幕坐标（CSS 像素）处会点中的物件 */
  pickAtClient(clientX: number, clientY: number): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    return this.pickAt(ndc);
  }

  /** 从上往下找第一个点在图标本体上的物件，透明区域不拦截下面的物件 */
  private pickAt(ndc: THREE.Vector2): string | null {
    this.raycaster.setFromCamera(ndc, this.camera);
    const candidates = [...this.meshes.values()].filter((m) => m.visible && m.userData.interactive);
    const hit = this.raycaster
      .intersectObjects(candidates, false)
      .find((h) => !h.uv || isItemHitAt(h.object.userData.itemId as string, h.uv.x, h.uv.y));
    return hit ? (hit.object.userData.instanceId as string) : null;
  }
  /** 找到一个点下去确实会命中该物件的屏幕坐标（CSS 像素）。用于新手引导和自动化测试 */
  findTapPoint(instanceId: string): { x: number; y: number } | null {
    const mesh = this.meshes.get(instanceId);
    if (!mesh || !mesh.visible) return null;
    this.scene.updateMatrixWorld();
    const rect = this.renderer.domElement.getBoundingClientRect();
    const size = (mesh.geometry as THREE.PlaneGeometry).parameters.width;
    const n = 11;
    const points: { x: number; y: number; d: number }[] = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const fx = (i + 0.5) / n - 0.5;
        const fy = (j + 0.5) / n - 0.5;
        const ndc = mesh.localToWorld(new THREE.Vector3(fx * size, fy * size, 0)).project(this.camera);
        // 浏览器的鼠标坐标是整数像素，取整后再验证，避免点在图标边缘差半个像素就点空
        const x = Math.round(rect.left + ((ndc.x + 1) / 2) * rect.width);
        const y = Math.round(rect.top + ((1 - ndc.y) / 2) * rect.height);
        points.push({ x, y, d: fx * fx + fy * fy });
      }
    }
    // 优先取靠近图标中心、并且周围 2 像素内也都能点中的位置
    points.sort((a, b) => a.d - b.d);
    const solid = (x: number, y: number) =>
      [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2]].every(([dx, dy]) => this.pickAtClient(x + dx, y + dy) === instanceId);
    const best = points.find((p) => solid(p.x, p.y)) ?? points.find((p) => this.pickAtClient(p.x, p.y) === instanceId);
    return best ? { x: best.x, y: best.y } : null;
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
    this.invalidate();
  }

  /** 物件飞向 HUD 格子（世界坐标），结束后从场景隐藏 */
  flyTo(instanceId: string, target: { x: number; y: number }, endScale: number, onDone?: () => void) {
    const mesh = this.meshes.get(instanceId);
    if (!mesh) return;
    if (this.hintId === instanceId) this.hintId = null;
    mesh.userData.interactive = false;
    const from = mesh.position.clone();
    // 目标是世界坐标，换算到物品堆的局部坐标
    const s = this.pile.scale.x;
    const to = { x: (target.x - this.pile.position.x) / s, y: (target.y - this.pile.position.y) / s };
    const fromRotation = mesh.rotation.z;
    mesh.position.z = 500;
    const lift = 120;
    this.addTween(mesh, 0.45, (t) => {
      const e = easeInOut(t);
      mesh.position.x = from.x + (to.x - from.x) * e;
      mesh.position.y = from.y + (to.y - from.y) * e + Math.sin(e * Math.PI) * lift;
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
    this.invalidate();
  }

  private addTween(mesh: THREE.Mesh, duration: number, update: (t: number) => void, onDone?: () => void) {
    this.tweens.push({ mesh, duration, elapsed: 0, update, onDone });
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener("pointerdown", this.handlePointer);
    this.clearPile();
    disposeChildren(this.backdrop, true);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

/** 释放并移除分组里的全部网格；disposeMaps 为 true 时连同贴图一起释放（只用于一次性贴图） */
function disposeChildren(group: THREE.Group, disposeMaps: boolean) {
  for (const child of [...group.children]) {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material as THREE.MeshBasicMaterial;
    if (disposeMaps) material?.map?.dispose();
    material?.dispose();
    group.remove(child);
  }
}

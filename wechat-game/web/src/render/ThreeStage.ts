import * as THREE from "three";
import type { ItemConfig, LevelConfig, SceneConfig } from "../core/types";
import { DESIGN_WIDTH, computeLayout, type StageLayout } from "../layout";
import { itemTexture, labelTexture } from "./sprites";

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
    // 提示脉冲加强：幅度 0.18、更快，让“该点这里”一眼就能看到
    const pulse = 1 + 0.18 * Math.sin(this.clock.elapsedTime * 12);
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
      // 整个贴图四边形都是点按热区（见 pickAt），不用精确点中图标线条
      mesh.userData = {
        instanceId: inst.id,
        itemId: inst.itemId,
        interactive: true,
        baseScale: 1,
      };
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

  /** 物品区是一整块底板，所有物件堆在上面；底板随布局铺满物品区。
   * 房间感底衬：上方墙面带 + 下方地板带 + 家具剪影（低饱和扁平色块，程序化绘制，无外部图片），
   * 10 关靠墙面/地板配色和家具剪影区分。正式美术到位后整段替换为场景底板图。 */
  private buildBackdrop(sceneConfig: SceneConfig) {
    disposeChildren(this.backdrop, true);
    const { x, y, width, height } = this.layout.board;
    this.scene.background = new THREE.Color(sceneConfig.background);
    const room = sceneConfig.room;
    const wallH = height * 0.3;
    // 墙面带（上）+ 地板带（下）+ 踢脚线
    this.plane(this.backdrop, width, wallH, x, y + height - wallH, 0, new THREE.MeshBasicMaterial({ color: room.wall }));
    this.plane(this.backdrop, width, height - wallH, x, y, 0.1, new THREE.MeshBasicMaterial({ color: room.floor }));
    this.plane(this.backdrop, width, 10, x, y + height - wallH - 5, 0.2, new THREE.MeshBasicMaterial({ color: shade(room.floor, 0.82) }));
    this.drawFurniture(room.furniture, x, y, width, height, wallH);
    const label = new THREE.MeshBasicMaterial({ map: labelTexture(sceneConfig.name, "rgba(255,255,255,0.35)"), transparent: true });
    this.plane(this.backdrop, 512, 96, x + width / 2 - 256, y + height / 2 - 48, 0.4, label);
  }

  /** 家具剪影：每种 2–5 个扁平色块，画在墙面带与物品区边缘，半透明、不抢物件的戏 */
  private drawFurniture(
    kind: SceneConfig["room"]["furniture"],
    x: number,
    y: number,
    w: number,
    h: number,
    wallH: number,
  ) {
    const main = new THREE.Color("#8a7a66");
    const dark = new THREE.Color("#6f6152");
    const mat = (color: THREE.Color) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.42 });
    // 每个矩形用 board 的相对坐标（fx/fy 从左下角起，宽高占 board 的比例），z 统一 0.3
    const rects: { fx: number; fy: number; fw: number; fh: number; c: THREE.Color }[] = (() => {
      const top = (h - wallH) / h; // 地板带顶部（相对高度）
      switch (kind) {
        case "bed": // 床头柜：床头板 + 枕头 + 被子
          return [
            { fx: 0.04, fy: top + 0.06, fw: 0.3, fh: 0.16, c: main },
            { fx: 0.08, fy: top + 0.02, fw: 0.1, fh: 0.05, c: dark },
            { fx: 0.2, fy: top + 0.02, fw: 0.1, fh: 0.05, c: dark },
          ];
        case "boxes": // 快递堆：三只叠放的纸箱
          return [
            { fx: 0.68, fy: top + 0.01, fw: 0.26, fh: 0.09, c: main },
            { fx: 0.72, fy: top + 0.1, fw: 0.2, fh: 0.08, c: dark },
            { fx: 0.75, fy: top + 0.18, fw: 0.14, fh: 0.07, c: main },
          ];
        case "counter": // 奶茶柜台：长柜台 + 两只杯子
          return [
            { fx: 0.05, fy: top + 0.01, fw: 0.9, fh: 0.07, c: main },
            { fx: 0.2, fy: top + 0.08, fw: 0.06, fh: 0.06, c: dark },
            { fx: 0.7, fy: top + 0.08, fw: 0.06, fh: 0.06, c: dark },
          ];
        case "drawer": // 抽屉柜：柜体 + 三层抽屉线
          return [
            { fx: 0.66, fy: top + 0.01, fw: 0.28, fh: 0.22, c: main },
            { fx: 0.68, fy: top + 0.08, fw: 0.24, fh: 0.015, c: dark },
            { fx: 0.68, fy: top + 0.15, fw: 0.24, fh: 0.015, c: dark },
          ];
        case "desk": // 书桌：桌面 + 两条腿
          return [
            { fx: 0.06, fy: top + 0.1, fw: 0.5, fh: 0.03, c: main },
            { fx: 0.08, fy: top + 0.01, fw: 0.03, fh: 0.1, c: dark },
            { fx: 0.5, fy: top + 0.01, fw: 0.03, fh: 0.1, c: dark },
          ];
        case "wardrobe": // 衣柜：高柜 + 两扇门
          return [
            { fx: 0.64, fy: top + 0.01, fw: 0.3, fh: 0.26, c: main },
            { fx: 0.785, fy: top + 0.01, fw: 0.01, fh: 0.26, c: dark },
          ];
        case "shelf": // 置物架：两层隔板
          return [
            { fx: 0.06, fy: top + 0.16, fw: 0.4, fh: 0.025, c: main },
            { fx: 0.06, fy: top + 0.06, fw: 0.4, fh: 0.025, c: main },
            { fx: 0.12, fy: top + 0.185, fw: 0.06, fh: 0.05, c: dark },
            { fx: 0.3, fy: top + 0.085, fw: 0.06, fh: 0.05, c: dark },
          ];
        case "sofa": // 沙发：靠背 + 座面 + 扶手
          return [
            { fx: 0.08, fy: top + 0.08, fw: 0.84, fh: 0.1, c: main },
            { fx: 0.08, fy: top + 0.01, fw: 0.84, fh: 0.08, c: dark },
            { fx: 0.08, fy: top + 0.01, fw: 0.08, fh: 0.17, c: main },
            { fx: 0.84, fy: top + 0.01, fw: 0.08, fh: 0.17, c: main },
          ];
        case "table": // 餐桌：桌面 + 两条腿
          return [
            { fx: 0.2, fy: top + 0.12, fw: 0.6, fh: 0.035, c: main },
            { fx: 0.26, fy: top + 0.01, fw: 0.035, fh: 0.12, c: dark },
            { fx: 0.7, fy: top + 0.01, fw: 0.035, fh: 0.12, c: dark },
          ];
      }
    })();
    for (const r of rects) {
      this.plane(this.backdrop, r.fw * w, r.fh * h, x + r.fx * w, y + r.fy * h, 0.3, mat(r.c));
    }
  }

  /**
   * 通关整洁 payoff：剩余物件淡出收起，底板变亮，露出整洁的房间——“从混乱走向整洁”的收尾。
   * 轻量实现：复用现有补间，不引入持续动画循环；exceptId（刚飞入找寻格的最后一件）不参与淡出。
   */
  celebrate(exceptId?: string) {
    const tidy = new THREE.Color("#f7f2e9");
    for (const [id, mesh] of this.meshes) {
      if (!mesh.visible || id === exceptId) continue;
      const material = mesh.material as THREE.MeshBasicMaterial;
      const startOpacity = material.opacity;
      this.addTween(mesh, 0.7, (t) => {
        material.opacity = startOpacity * (1 - t);
        mesh.scale.setScalar(1 - 0.25 * t);
      }, () => {
        mesh.visible = false;
        material.opacity = startOpacity;
        mesh.scale.setScalar(1);
      });
    }
    // 底板同步变亮：取第一个底板网格挂一个补间，update 里改全部底板平面的颜色
    const planes = this.backdrop.children
      .map((c) => (c as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined)
      .filter((m): m is THREE.MeshBasicMaterial => !!m && m.color !== undefined);
    const starts = planes.map((m) => m.color.clone());
    const anchor = this.backdrop.children[0] as THREE.Mesh | undefined;
    if (anchor) {
      this.addTween(anchor, 0.7, (t) => {
        planes.forEach((m, i) => m.color.lerpColors(starts[i], tidy, t * 0.6));
      });
    }
    this.invalidate();
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

  /** 从上往下找第一个被点中的物件：整个贴图四边形都是热区，透明区域也算，
   * 是否可点完全由层级决定——点中谁就由最上层的物件说了算，不再按图标轮廓掩码过滤。
   * （旧做法只认 48×48 掩码里的实心格，细线条图标大半区域点不中，只能点正中间。） */
  private pickAt(ndc: THREE.Vector2): string | null {
    this.raycaster.setFromCamera(ndc, this.camera);
    const candidates = [...this.meshes.values()].filter((m) => m.visible && m.userData.interactive);
    const hit = this.raycaster.intersectObjects(candidates, false)[0];
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

  /** 断点续玩：恢复快照时，已拿走 / 已进归位格的物件直接隐藏，不参与点击 */
  hideInstance(instanceId: string) {
    const mesh = this.meshes.get(instanceId);
    if (!mesh) return;
    mesh.visible = false;
    mesh.userData.interactive = false;
    this.invalidate();
  }

  /** 解锁脉冲：刚变为可点的物件轻轻放大一下作为提示。
   * 所有物件始终保持全亮、不压暗（2026-11-12 改：被遮挡不再灰化，是否可点完全由层级决定，
   * 点中被压住的物件时由 GameSession 返回 blocked、舞台抖动反馈）。 */
  pulseUnblocked(instanceId: string) {
    const mesh = this.meshes.get(instanceId);
    if (!mesh || !mesh.visible || this.tweens.some((tw) => tw.mesh === mesh)) return;
    this.addTween(mesh, 0.25, (t) => mesh.scale.setScalar(1 + 0.12 * Math.sin(t * Math.PI)));
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

/** 颜色加深（f < 1）或变亮（f > 1），用于从地板色派生踢脚线等相近色 */
function shade(hex: string, f: number): THREE.Color {
  return new THREE.Color(hex).multiplyScalar(f);
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

// 店长电脑面板:三个标签页(商品采购 / 设备 & 装饰 / 订单),分页浏览,下单、加急、金币不足时看广告。
// 面板只负责显示和把点击翻译成对 GameSession 的命令;所有规则(够不够钱、解锁等级、送达时间)都在 core 里。
import { BlockInputEvents, Canvas, Color, Label, Node, view } from 'cc';
import type { GameSession } from '../core/GameSession';
import { AD_COIN_REWARD, CONTAINER_NAMES, CatalogItem, EQUIPMENT, EXPANSIONS, GOODS, THEMES, catalogKey, getCatalogItem, unitOrderCost } from '../core/data/Catalog';
import type { AdProvider } from '../core/services/AdProvider';
import { WEATHER } from '../core/events/Weather';
import { describeAbsoluteMinute } from '../core/time/GameClock';
import { EXPANSION_SIZES } from '../core/world/StoreLayout';
import { COLOR_WHITE, UiButton, makeButton, makeLabel, makeNode, makeRect } from './UiKit';

type Tab = 'goods' | 'equipment' | 'expand' | 'themes' | 'orders' | 'weather';
const TABS: Tab[] = ['goods', 'equipment', 'expand', 'themes', 'orders', 'weather'];
const TAB_NAMES = ['商品', '设备', '扩建', '外观', '订单', '天气'];

const PANEL_W = 960;
const PANEL_H = 600;
const ROWS = 5;
const ROW_H = 70;

const BLUE = new Color(52, 120, 220, 255);
const GRAY = new Color(86, 92, 110, 255);
const GREEN = new Color(46, 168, 90, 255);
const ORANGE = new Color(226, 140, 40, 255);
const MUTED = new Color(170, 178, 196, 255);
const GOLD = new Color(255, 214, 90, 255);

interface Row {
    root: Node;
    name: Label;
    detail: Label;
    price: Label;
    action: UiButton;
}

export interface ComputerPanelDeps {
    session: GameSession;
    ads: AdProvider;
    onClose: () => void;
}

export class ComputerPanel {
    private readonly root: Node;
    private readonly coins: Label;
    private readonly message: Label;
    private readonly pageLabel: Label;
    private readonly tabButtons: UiButton[] = [];
    private readonly rows: Row[] = [];
    private readonly adButton: UiButton;
    private readonly prevButton: UiButton;
    private readonly nextButton: UiButton;

    private tab: Tab = 'goods';
    private page = 0;
    private needCoins = false;
    private lastSignature = '';

    constructor(canvas: Canvas, private readonly deps: ComputerPanelDeps) {
        const size = view.getVisibleSize();
        this.root = makeNode(canvas.node, 'ComputerPanel');

        // 全屏遮罩:压暗背景,并拦截点击,避免点到下面的 HUD 按钮
        const overlay = makeRect(this.root, 'Overlay', size.width * 2, size.height * 2, 0, 0, new Color(0, 0, 0, 150), 0);
        overlay.addComponent(BlockInputEvents);
        const bg = makeRect(this.root, 'Bg', PANEL_W, PANEL_H, 0, 0, new Color(28, 32, 44, 250), 18);
        bg.addComponent(BlockInputEvents);

        const left = -PANEL_W / 2 + 30;
        const top = PANEL_H / 2;
        makeLabel(this.root, 'Title', '店长电脑 · 采购', { size: 30, align: Label.HorizontalAlign.LEFT, ax: 0 }, left, top - 38);
        this.coins = makeLabel(this.root, 'Coins', '', { size: 26, color: GOLD, align: Label.HorizontalAlign.RIGHT, ax: 1 }, PANEL_W / 2 - 150, top - 38);
        makeButton(this.root, 'Close', '关闭', 100, 48, PANEL_W / 2 - 70, top - 38, GRAY, () => this.close());

        TABS.forEach((t, i) => {
            const btn = makeButton(this.root, `Tab_${t}`, TAB_NAMES[i], 140, 52, left + 70 + i * 148, top - 96, GRAY, () => this.switchTab(t));
            this.tabButtons.push(btn);
        });

        const firstRowY = top - 140 - ROW_H / 2;
        for (let i = 0; i < ROWS; i++) this.rows.push(this.makeRow(firstRowY - i * ROW_H));

        const footerY = -PANEL_H / 2 + 36;
        this.message = makeLabel(this.root, 'Message', '', { size: 22, color: COLOR_WHITE, align: Label.HorizontalAlign.LEFT, ax: 0 }, left, footerY + 52);
        this.prevButton = makeButton(this.root, 'Prev', '上一页', 110, 46, left + 55, footerY, GRAY, () => this.turnPage(-1));
        this.pageLabel = makeLabel(this.root, 'Page', '', { size: 22, color: MUTED }, left + 160, footerY);
        this.nextButton = makeButton(this.root, 'Next', '下一页', 110, 46, left + 265, footerY, GRAY, () => this.turnPage(1));
        this.adButton = makeButton(this.root, 'AdCoins', `看广告获取 ${AD_COIN_REWARD} 金币`, 330, 46, PANEL_W / 2 - 195, footerY, ORANGE, () => this.watchAdForCoins());
        this.adButton.setVisible(false);

        this.root.active = false;
    }

    get isOpen(): boolean {
        return this.root.active;
    }

    open(): void {
        this.tab = 'goods';
        this.page = 0;
        this.needCoins = false;
        this.setMessage('');
        this.root.active = true;
        this.render();
    }

    close(): void {
        if (!this.root.active) return;
        this.root.active = false;
        this.deps.onClose();
    }

    /** 面板打开时每帧调用:游戏状态(金币、订单)变了才重绘。 */
    update(): void {
        if (!this.root.active) return;
        if (this.signature() !== this.lastSignature) this.render();
    }

    /** 面板上会显示的游戏状态的摘要;变了就需要重绘。 */
    private signature(): string {
        const s = this.deps.session.state;
        const orders = s.orders.map((o) => `${o.id}${o.status[0]}`).join(',');
        return `${this.tab}|${this.page}|${this.needCoins}|${s.coins}|${s.level}|${orders}|${s.expansion}|${s.theme}|${s.unlockedThemes.join(',')}|${s.weather}|${s.forecast.join(',')}|${s.supplierDiscount ? s.supplierDiscount.factor : 1}`;
    }

    // ---------- 交互 ----------

    private switchTab(tab: Tab): void {
        this.tab = tab;
        this.page = 0;
        this.needCoins = false;
        this.setMessage('');
        this.render();
    }

    private turnPage(delta: number): void {
        this.page = Math.max(0, this.page + delta);
        this.render();
    }

    private buy(key: string, name: string): void {
        const result = this.deps.session.placeOrder(key, 1);
        if (result.ok) {
            this.needCoins = false;
            const order = this.deps.session.state.orders[this.deps.session.state.orders.length - 1];
            this.setMessage(`已下单:${name},预计 ${this.etaText(order.arriveAtMinute)} 送达`);
        } else {
            this.needCoins = result.code === 'insufficient_coins';
            this.setMessage(result.reason);
        }
        this.render();
    }

    private expand(): void {
        const r = this.deps.session.expandStore();
        this.needCoins = !r.ok && r.code === 'insufficient_coins';
        this.setMessage(r.ok ? r.info ?? '扩建完成' : r.reason);
        this.render();
    }

    private useTheme(id: string): void {
        const r = this.deps.session.setTheme(id);
        this.setMessage(r.ok ? '已更换外观' : r.reason);
        this.render();
    }

    /** 主题要先看广告才能解锁(默认主题除外)。 */
    private unlockThemeByAd(id: string): void {
        this.deps.ads.showRewarded('theme', (rewarded) => {
            if (!rewarded) {
                this.setMessage('没有看完广告,没有解锁');
            } else {
                const r = this.deps.session.unlockTheme(id);
                this.setMessage(r.ok ? r.info ?? '已解锁' : r.reason);
            }
            this.render();
        });
    }

    private expedite(orderId: number): void {
        this.deps.ads.showRewarded('expedite_order', (rewarded) => {
            if (!rewarded) {
                this.setMessage('没有看完广告,订单没有加急');
            } else {
                const r = this.deps.session.expediteOrder(orderId);
                this.setMessage(r.ok ? '货车马上就到了!' : r.reason);
            }
            this.render();
        });
    }

    private watchAdForCoins(): void {
        this.deps.ads.showRewarded('coins', (rewarded) => {
            if (rewarded) {
                this.deps.session.rewardCoins(AD_COIN_REWARD);
                this.needCoins = false;
                this.setMessage(`获得 ${AD_COIN_REWARD} 金币`);
            } else {
                this.setMessage('没有看完广告,没有获得金币');
            }
            this.render();
        });
    }

    // ---------- 显示 ----------

    private setMessage(text: string): void {
        this.message.string = text;
    }

    private etaText(arriveAtMinute: number): string {
        const d = describeAbsoluteMinute(arriveAtMinute);
        return d.day > this.deps.session.state.day ? `第 ${d.day} 天 ${d.clock}` : d.clock;
    }

    private makeRow(y: number): Row {
        const root = makeNode(this.root, 'Row', 0, y);
        makeRect(root, 'RowBg', PANEL_W - 60, ROW_H - 8, 0, 0, new Color(40, 46, 62, 255), 10);
        const x = -(PANEL_W - 60) / 2 + 20;
        const name = makeLabel(root, 'Name', '', { size: 26, align: Label.HorizontalAlign.LEFT, ax: 0 }, x, 12);
        const detail = makeLabel(root, 'Detail', '', { size: 18, color: MUTED, align: Label.HorizontalAlign.LEFT, ax: 0 }, x, -15);
        const price = makeLabel(root, 'Price', '', { size: 24, color: GOLD, align: Label.HorizontalAlign.RIGHT, ax: 1 }, 190, 0);
        const row: Row = { root, name, detail, price, action: null as unknown as UiButton };
        row.action = makeButton(root, 'Action', '', 160, 48, 300, 0, BLUE, () => this.handlers[this.rows.indexOf(row)]?.());
        return row;
    }

    /** 当前页每一行点击按钮时要执行的动作(随 render 更新)。 */
    private handlers: Array<() => void> = [];

    private models(): RowModel[] {
        const s = this.deps.session.state;
        if (this.tab === 'weather') {
            const days = ['今天', '明天', '后天'];
            const kinds = [s.weather, s.forecast[0], s.forecast[1]];
            return kinds.map((k, i) => ({
                name: `${days[i]}:${WEATHER[k].name}`,
                detail: WEATHER[k].tip,
                price: '',
                actionText: '',
                actionColor: BLUE,
                actionEnabled: false,
                actionVisible: false,
                onAction: () => undefined,
            }));
        }
        if (this.tab === 'expand') {
            const rows: RowModel[] = [];
            for (let i = 1; i < EXPANSIONS.length; i++) {
                const rule = EXPANSIONS[i];
                const size = EXPANSION_SIZES[i];
                const done = s.expansion >= i;
                const isNext = s.expansion + 1 === i;
                const levelLocked = s.level < rule.unlockLevel;
                rows.push({
                    name: `${rule.name}(${size.w} × ${size.d} 米)`,
                    detail: `需要超市 ${rule.unlockLevel} 级 · 扩建后店内多出空地,可以摆更多货架和冷柜`,
                    price: `${rule.cost} 金币`,
                    actionText: done ? '已扩建' : !isNext ? '先扩建上一级' : levelLocked ? `${rule.unlockLevel} 级解锁` : '扩建',
                    actionColor: GREEN,
                    actionEnabled: isNext && !levelLocked,
                    actionVisible: true,
                    onAction: () => this.expand(),
                });
            }
            return rows;
        }
        if (this.tab === 'themes') {
            return THEMES.map((t) => {
                const unlocked = s.unlockedThemes.indexOf(t.id) >= 0;
                const active = s.theme === t.id;
                const levelOk = s.level >= t.unlockLevel;
                const status = unlocked ? '已解锁' : levelOk ? '看广告即可永久解锁' : `需要 ${t.unlockLevel} 级,并看广告解锁`;
                return {
                    name: t.name,
                    detail: `${status} · 只改变外观,没有收益加成`,
                    price: '',
                    actionText: active ? '使用中' : unlocked ? '使用' : levelOk ? '看广告解锁' : `${t.unlockLevel} 级解锁`,
                    actionColor: unlocked ? BLUE : ORANGE,
                    actionEnabled: !active && (unlocked || levelOk),
                    actionVisible: true,
                    onAction: () => (unlocked ? this.useTheme(t.id) : this.unlockThemeByAd(t.id)),
                };
            });
        }
        if (this.tab === 'orders') {
            return s.orders
                .slice()
                .reverse()
                .map((o) => {
                    const item = getCatalogItem(o.itemId);
                    const unit = item && item.kind === 'goods' ? '批' : '件';
                    const delivering = o.status === 'delivering';
                    return {
                        name: `${item ? item.name : o.itemId} × ${o.quantity} ${unit}`,
                        detail: delivering ? (WEATHER[s.weather].trucksStopped ? '货车停运,天气转好才会送达(可看广告加急)' : `配送中 · 预计 ${this.etaText(o.arriveAtMinute)} 送达`) : '已到货 · 货车停在店门口,等你搬进店里',
                        price: `已花 ${o.cost}`,
                        actionText: '看广告加急',
                        actionColor: ORANGE,
                        actionEnabled: true,
                        actionVisible: delivering,
                        onAction: () => this.expedite(o.id),
                    };
                });
        }

        const items: CatalogItem[] = this.tab === 'goods' ? GOODS : EQUIPMENT;
        return items.map((item) => {
            const locked = s.level < item.unlockLevel;
            const key = catalogKey(item);
            const detail =
                item.kind === 'goods'
                    ? `${item.category} · ${CONTAINER_NAMES[item.container]} · 占 ${item.slots} 格 · 每批 ${item.batchSize} 件 · 进价 ${item.unitCost} 售价 ${item.unitPrice}`
                    : item.description;
            return {
                name: item.name,
                detail,
                price: `${this.priceText(key, item)}`,
                actionText: locked ? `${item.unlockLevel} 级解锁` : item.kind === 'goods' ? '购买 1 批' : '购买',
                actionColor: BLUE,
                actionEnabled: !locked,
                actionVisible: true,
                onAction: () => this.buy(key, item.name),
            };
        });
    }

    /** 采购价文字;供货商限时折扣期间同时显示折后价。 */
    private priceText(key: string, item: CatalogItem): string {
        const base = unitOrderCost(item);
        const now = this.deps.session.orderCost(key, 1);
        const unit = item.kind === 'goods' ? ' / 批' : '';
        return now < base ? `${now} 金币${unit}(限时折扣)` : `${base} 金币${unit}`;
    }

    private render(): void {
        const s = this.deps.session.state;
        const models = this.models();
        const pages = Math.max(1, Math.ceil(models.length / ROWS));
        this.page = Math.min(this.page, pages - 1);
        const slice = models.slice(this.page * ROWS, this.page * ROWS + ROWS);

        this.handlers = slice.map((m) => m.onAction);
        this.rows.forEach((row, i) => {
            const m = slice[i];
            row.root.active = m !== undefined;
            if (!m) return;
            row.name.string = m.name;
            row.detail.string = m.detail;
            row.price.string = m.price;
            row.action.setText(m.actionText);
            row.action.setColor(m.actionColor);
            row.action.setEnabled(m.actionEnabled);
            row.action.setVisible(m.actionVisible);
        });

        this.tabButtons.forEach((b, i) => b.setColor(TABS[i] === this.tab ? BLUE : GRAY));
        this.coins.string = `金币 ${s.coins}`;
        this.pageLabel.string = `第 ${this.page + 1} / ${pages} 页`;
        this.prevButton.setEnabled(this.page > 0);
        this.nextButton.setEnabled(this.page < pages - 1);
        this.adButton.setVisible(this.needCoins);
        this.lastSignature = this.signature();
    }
}

interface RowModel {
    name: string;
    detail: string;
    price: string;
    actionText: string;
    actionColor: Color;
    actionEnabled: boolean;
    actionVisible: boolean;
    onAction: () => void;
}

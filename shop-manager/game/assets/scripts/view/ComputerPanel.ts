// 店长电脑面板:三个标签页(商品采购 / 设备 & 装饰 / 订单),分页浏览,下单、加急、金币不足时看广告。
// 面板只负责显示和把点击翻译成对 GameSession 的命令;所有规则(够不够钱、解锁等级、送达时间)都在 core 里。
import { BlockInputEvents, Canvas, Color, Label, Node, view } from 'cc';
import type { GameSession } from '../core/GameSession';
import { AD_COIN_REWARD, CONTAINER_NAMES, CatalogItem, EQUIPMENT, EXPANSIONS, GOODS, THEMES, catalogKey, getCatalogItem, unitOrderCost } from '../core/data/Catalog';
import { ADS, DISTRESS, MERCHANT, STAFF } from '../core/data/Balance';
import { MERCHANTS, getMerchant } from '../core/data/Merchants';
import { leaseAt, merchantsUnlocked, renewFee, slotCount } from '../core/merchants/MerchantSystem';
import type { AdPlacement, AdProvider } from '../core/services/AdProvider';
import { STAFF_ROLES, dailyWages } from '../core/staff/StaffSystem';
import { SURVEY_QUESTIONS, wishText } from '../core/customers/Feedback';
import { WEATHER } from '../core/events/Weather';
import { describeAbsoluteMinute } from '../core/time/GameClock';
import { EXPANSION_SIZES } from '../core/world/StoreLayout';
import { COLOR_WHITE, UiButton, makeButton, makeLabel, makeNode, makeRect } from './UiKit';

type Tab = 'goods' | 'equipment' | 'expand' | 'themes' | 'orders' | 'weather' | 'feedback' | 'merchants' | 'staff' | 'perks';
const TABS: Tab[] = ['goods', 'equipment', 'expand', 'themes', 'orders', 'weather', 'feedback', 'merchants', 'staff', 'perks'];
const TAB_NAMES = ['商品', '设备', '扩建', '外观', '订单', '天气', '反馈', '招商', '员工', '福利'];

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
            const btn = makeButton(this.root, `Tab_${t}`, TAB_NAMES[i], 84, 52, left + 42 + i * 90, top - 96, GRAY, () => this.switchTab(t));
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
        return `${this.tab}|${this.page}|${this.needCoins}|${s.coins}|${s.level}|${orders}|${s.expansion}|${s.theme}|${s.unlockedThemes.join(',')}|${s.weather}|${s.forecast.join(',')}|${s.supplierDiscount ? s.supplierDiscount.factor : 1}|${s.feedback.length}:${s.nextFeedbackId}|${s.merchants.map((l) => `${l.slot}${l.merchantId}${l.expiresDay}`).join(',')}|${s.staff.length}|${s.distressDays}|${s.ads.day}:${JSON.stringify(s.ads.used)}|${s.fixtures.length}`;
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
        if (!this.adLeft('theme')) return;
        this.deps.ads.showRewarded('theme', (rewarded) => {
            if (!rewarded) {
                this.setMessage('没有看完广告,没有解锁');
            } else {
                const r = this.deps.session.unlockThemeFromAd(id);
                this.setMessage(r.ok ? r.info ?? '已解锁' : r.reason);
            }
            this.render();
        });
    }

    private expedite(orderId: number): void {
        if (!this.adLeft('expedite_order')) return;
        this.deps.ads.showRewarded('expedite_order', (rewarded) => {
            if (!rewarded) {
                this.setMessage('没有看完广告,订单没有加急');
            } else {
                const r = this.deps.session.expediteOrderFromAd(orderId);
                this.setMessage(r.ok ? '货车马上就到了!' : r.reason);
            }
            this.render();
        });
    }

    /** 今天这个广告场景还有次数吗?没有就提示玩家(广告次数上限由 core 统一执行,这里只是提前告知)。 */
    private adLeft(placement: AdPlacement): boolean {
        if (this.deps.session.adRemaining(placement) > 0) return true;
        this.setMessage('今天的广告次数用完了,明天再来吧');
        this.render();
        return false;
    }

    private watchAdForCoins(): void {
        if (!this.adLeft('coins')) return;
        this.deps.ads.showRewarded('coins', (rewarded) => {
            if (rewarded) {
                const r = this.deps.session.rewardCoinsFromAd();
                this.needCoins = !r.ok ? this.needCoins : false;
                this.setMessage(r.ok ? `获得 ${AD_COIN_REWARD} 金币` : r.reason);
            } else {
                this.setMessage('没有看完广告,没有获得金币');
            }
            this.render();
        });
    }

    private watchAdForBuff(): void {
        if (!this.adLeft('buff')) return;
        this.deps.ads.showRewarded('buff', (rewarded) => {
            if (rewarded) {
                const r = this.deps.session.activateBuffFromAd();
                this.setMessage(r.ok ? r.info ?? '人气 buff 已开启' : r.reason);
            } else {
                this.setMessage('没有看完广告,没有开启 buff');
            }
            this.render();
        });
    }

    /** 执行一个返回 CommandResult 的命令,把结果显示在底部提示里。 */
    private run(r: { ok: true; info?: string } | { ok: false; reason: string; code?: string }): void {
        this.setMessage(r.ok ? r.info ?? '完成' : r.reason);
        this.needCoins = !r.ok && r.code === 'insufficient_coins';
        this.render();
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
        if (this.tab === 'merchants') return this.merchantRows();
        if (this.tab === 'staff') return this.staffRows();
        if (this.tab === 'perks') return this.perkRows();
        if (this.tab === 'feedback') {
            if (s.feedback.length === 0) {
                return [{
                    name: '还没有顾客反馈',
                    detail: '头顶有黄色问卷标记的顾客结账后会留下问卷;暗访顾客(2 级起)离店后会留下评价',
                    price: '',
                    actionText: '',
                    actionColor: BLUE,
                    actionEnabled: false,
                    actionVisible: false,
                    onAction: () => undefined,
                }];
            }
            return s.feedback
                .slice()
                .reverse()
                .map((f) => {
                    const answers = `货架${SURVEY_QUESTIONS[0].options[f.find]} · 等待${SURVEY_QUESTIONS[1].options[f.wait]} · 想要:${wishText(f)}`;
                    const notes = f.reasons.length > 0 ? ` · 意见:${f.reasons.slice(0, 2).join('、')}` : ' · 没有意见';
                    return {
                        name: `第 ${f.day} 天 · ${f.kind === 'survey' ? '问卷' : '暗访'} · ${f.rating} / 5 分${f.paid ? '' : '(没买成)'}`,
                        detail: answers + notes,
                        price: '',
                        actionText: '',
                        actionColor: BLUE,
                        actionEnabled: false,
                        actionVisible: false,
                        onAction: () => undefined,
                    };
                });
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
                    actionText: active ? '使用中' : unlocked ? '使用' : !levelOk ? `${t.unlockLevel} 级解锁` : this.deps.ads.available ? '看广告解锁' : '暂无广告',
                    actionColor: unlocked ? BLUE : ORANGE,
                    actionEnabled: !active && (unlocked || (levelOk && this.deps.ads.available)),
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
                        actionVisible: delivering && this.deps.ads.available,
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

    private info(name: string, detail: string): RowModel {
        return { name, detail, price: '', actionText: '', actionColor: BLUE, actionEnabled: false, actionVisible: false, onAction: () => undefined };
    }

    private merchantRows(): RowModel[] {
        const s = this.deps.session.state;
        if (!merchantsUnlocked(s)) {
            return [this.info('招商还没解锁', `需要超市 ${MERCHANT.unlockLevel} 级,并且至少扩建 ${MERCHANT.minExpansion} 次(扩建后每次多一个档口)`)];
        }
        const rows: RowModel[] = [];
        for (let slot = 0; slot < slotCount(s); slot++) {
            const lease = leaseAt(s, slot);
            const def = lease ? getMerchant(lease.merchantId) : undefined;
            if (lease && def) {
                const warn = lease.badDays > 0 ? ` · 预警:满意度太低或事故太多,再这样商户会搬走` : '';
                rows.push({
                    name: `档口 ${slot + 1} · ${def.name}`,
                    detail: `每天租金 ${def.rentPerDay} · 租期到第 ${lease.expiresDay} 天${warn}`,
                    price: '',
                    actionText: `续约(${renewFee(def.id)})`,
                    actionColor: GREEN,
                    actionEnabled: true,
                    actionVisible: true,
                    onAction: () => this.run(this.deps.session.renewMerchant(slot)),
                });
                rows.push({
                    name: `档口 ${slot + 1} · 收回铺面`,
                    detail: `退还押金 ${def.deposit};之后可以换别的商户`,
                    price: '',
                    actionText: '收回',
                    actionColor: ORANGE,
                    actionEnabled: true,
                    actionVisible: true,
                    onAction: () => this.run(this.deps.session.reclaimMerchant(slot)),
                });
                continue;
            }
            for (const m of MERCHANTS) {
                const locked = s.level < m.unlockLevel;
                rows.push({
                    name: `档口 ${slot + 1} · 招${m.name}`,
                    detail: `${m.desc} · 租金 ${m.rentPerDay}/天 · 租期 ${MERCHANT.termDays} 天`,
                    price: `押金 ${m.deposit}`,
                    actionText: locked ? `${m.unlockLevel} 级解锁` : '签约',
                    actionColor: BLUE,
                    actionEnabled: !locked,
                    actionVisible: true,
                    onAction: () => this.run(this.deps.session.signMerchant(slot, m.id)),
                });
            }
        }
        return rows;
    }

    private staffRows(): RowModel[] {
        const s = this.deps.session.state;
        const rows: RowModel[] = STAFF_ROLES.map((role) => {
            const rule = STAFF[role];
            const member = s.staff.filter((x) => x.role === role)[0];
            const locked = s.level < rule.unlockLevel;
            return {
                name: rule.name,
                detail: `${rule.desc} · 工资 ${rule.wage}/天,发不出就离职`,
                price: member ? '' : `雇佣费 ${rule.hireFee}`,
                actionText: member ? '辞退' : locked ? `${rule.unlockLevel} 级解锁` : '雇佣',
                actionColor: member ? ORANGE : BLUE,
                actionEnabled: member !== undefined || !locked,
                actionVisible: true,
                onAction: () => this.run(member ? this.deps.session.fireStaff(member.id) : this.deps.session.hireStaff(role)),
            };
        });
        rows.push(this.info('今日工资合计', `${dailyWages(s)} 金币/天;员工和你用同一套规则,结果和亲手做一样`));
        return rows;
    }

    private perkRows(): RowModel[] {
        const s = this.deps.session.state;
        const left = (p: AdPlacement) => this.deps.session.adRemaining(p);
        const rows: RowModel[] = [
            {
                name: `看广告领 ${AD_COIN_REWARD} 金币`,
                detail: `自愿观看 · 今天还能看 ${left('coins')} 次`,
                price: '',
                actionText: '看广告',
                actionColor: ORANGE,
                actionEnabled: left('coins') > 0 && this.deps.ads.available,
                actionVisible: true,
                onAction: () => this.watchAdForCoins(),
            },
            {
                name: '看广告开启人气 buff',
                detail: `今天客流 ×${ADS.buffTraffic} · 今天还能看 ${left('buff')} 次`,
                price: '',
                actionText: '看广告',
                actionColor: ORANGE,
                actionEnabled: left('buff') > 0 && this.deps.ads.available,
                actionVisible: true,
                onAction: () => this.watchAdForBuff(),
            },
        ];
        if (this.deps.session.distress) {
            rows.unshift(this.info('资金紧张', `金币很少又没货可卖:不能采购设备。可以看广告、卖设备或辞退员工;金币回到 ${DISTRESS.recoverCoins} 就恢复`));
            for (const f of s.fixtures) {
                if (!f.movable || !f.equipId) continue;
                const def = getCatalogItem(`equip:${f.equipId}`);
                if (!def || def.kind !== 'equipment') continue;
                rows.push({
                    name: `卖掉:${def.name}`,
                    detail: `返还原价 ${def.price} 的 ${Math.round(DISTRESS.sellRatio * 100)}%;里面有商品要先拿走`,
                    price: `+${Math.round(def.price * DISTRESS.sellRatio)} 金币`,
                    actionText: '卖掉',
                    actionColor: ORANGE,
                    actionEnabled: true,
                    actionVisible: true,
                    onAction: () => this.run(this.deps.session.sellFixture(f.id)),
                });
            }
        }
        return rows;
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
        this.adButton.setVisible(this.needCoins && this.deps.ads.available);
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

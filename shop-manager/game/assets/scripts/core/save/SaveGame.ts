// 存档:只保存状态数据(JSON),不保存任何 3D 对象。带 schema_version,旧版本存档会逐级迁移到最新结构。
//
// 版本历史:
//   v1:coins / satisfaction / level / day / timeOfDay / isOpen
//   v2:新增 orders(采购订单)与 nextOrderId
//   v3:新增 cartons(纸箱)、nextCartonId、stock(货架库存)、warehouse(仓库设备)
//   v4:新增 xp、customers、统计(today/pendingReport/totalServed)、随机数状态、新手引导进度;纸箱增加 xpLeft
//   v5:新增 fixtures(店内设施,可摆放)、expansion(扩建等级)、theme/unlockedThemes(外观)、trash(垃圾)
//   v6:新增 weather/forecast(天气与预报)、events(突发事件)、eventCooldown、priceFactors(促销价)、supplierDiscount(进货折扣)
//   v7:新增 market(竞争带来的限时客流/进货价/售价影响);事件类型增加火情、抽查、价格战、竞品、供货商被抢
//   v8:顾客增加 kind(普通/问卷/暗访)与 missedItems;新增 feedback(顾客反馈记录)与 nextFeedbackId
//   v9:新增 merchants(招商)、staff/nextStaffId(员工)、ads(每日广告次数)、distressDays(资金紧张)、incidentsToday
import { DEFAULT_THEME_ID, THEMES } from '../data/Catalog';
import { isWeatherKind } from '../events/Weather';
import { xpForLevel } from '../data/Levels';
import { unitsForOrder } from '../inventory/Inventory';
import { EVENT_TYPES, createDayStats } from '../state/GameState';
import type { ActiveEvent, Carton, CartLine, Customer, CustomerKind, DayReport, DayStats, AdUsage, FeedbackRecord, GameState, MarketState, MerchantLease, StaffMember, StaffRole, Order, PriceFactor, TrashPiece, TutorialState, WantLine } from '../state/GameState';
import { TUTORIAL_STEP_COUNT } from '../tutorial/Tutorial';
import { EXPANSION_SIZES, FRONTS, Fixture, FixtureKind, initialFixtures } from '../world/StoreLayout';
import type { KeyValueStorage } from './KeyValueStorage';

export const SAVE_SCHEMA_VERSION = 9;

export type LoadResult =
    | { kind: 'empty' }
    | { kind: 'ok'; state: GameState }
    | { kind: 'corrupt'; reason: string }
    /** 存档来自更新的游戏版本:不能读,也不能覆盖。 */
    | { kind: 'tooNew'; version: number };

export function serializeState(state: GameState): string {
    return JSON.stringify({ schema_version: SAVE_SCHEMA_VERSION, state });
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => isNum(v) && Number.isInteger(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v !== '';

// ---------------------------------------------------------------- 迁移

/** v1 -> v2:补上订单相关字段。 */
function migrateV1toV2(obj: any): any {
    const s = obj.state;
    if (typeof s === 'object' && s !== null) {
        s.orders = [];
        s.nextOrderId = 1;
    }
    obj.schema_version = 2;
    return obj;
}

/** v2 -> v3:已送达但还没处理的订单,补成卸货区里的纸箱;库存与仓库为空。 */
function migrateV2toV3(obj: any): any {
    const s = obj.state;
    if (typeof s === 'object' && s !== null) {
        const cartons: any[] = [];
        let nextId = 1;
        if (Array.isArray(s.orders)) {
            for (const o of s.orders) {
                if (o && o.status === 'arrived' && typeof o.itemId === 'string' && isInt(o.quantity) && o.quantity >= 1) {
                    cartons.push({ id: nextId++, orderId: o.id, itemId: o.itemId, units: unitsForOrder(o), location: 'door' });
                }
            }
        }
        s.cartons = cartons;
        s.nextCartonId = nextId;
        s.stock = {};
        s.warehouse = {};
    }
    obj.schema_version = 3;
    return obj;
}

/** v3 -> v4:补上经验、顾客、统计、随机数与新手引导。已经玩过的存档直接视为引导完成。 */
function migrateV3toV4(obj: any): any {
    const s = obj.state;
    if (typeof s === 'object' && s !== null) {
        if (Array.isArray(s.cartons)) {
            for (const c of s.cartons) {
                if (c && typeof c === 'object') c.xpLeft = c.orderId !== null && c.orderId !== undefined && isInt(c.units) ? c.units : 0;
            }
        }
        s.xp = isInt(s.level) ? xpForLevel(s.level) : 0;
        s.customers = [];
        s.nextCustomerId = 1;
        s.nextQueueSeq = 1;
        s.spawnProgress = 0;
        s.rngState = 20261026;
        s.totalServed = 0;
        s.today = createDayStats(isInt(s.day) ? s.day : 1, isNum(s.satisfaction) ? s.satisfaction : 60);
        s.pendingReport = null;
        const progressed =
            (isInt(s.day) && s.day > 1) ||
            (s.stock && typeof s.stock === 'object' && Object.keys(s.stock).length > 0) ||
            (Array.isArray(s.orders) && s.orders.length > 0) ||
            (Array.isArray(s.cartons) && s.cartons.length > 0);
        s.tutorial = { step: progressed ? TUTORIAL_STEP_COUNT : 0, moved: !!progressed };
    }
    obj.schema_version = 4;
    return obj;
}

/** v4 -> v5:店内设施改为存档数据(用初始布局),扩建 0 级,默认主题,没有垃圾。 */
function migrateV4toV5(obj: any): any {
    const s = obj.state;
    if (typeof s === 'object' && s !== null) {
        s.fixtures = initialFixtures();
        s.nextFixtureId = 1;
        s.expansion = 0;
        s.theme = DEFAULT_THEME_ID;
        s.unlockedThemes = [DEFAULT_THEME_ID];
        s.trash = [];
        s.nextTrashId = 1;
    }
    obj.schema_version = 5;
    return obj;
}

/** v5 -> v6:天气设为晴并预报两个晴天,没有进行中的事件和促销。 */
function migrateV5toV6(obj: any): any {
    const s = obj.state;
    if (typeof s === 'object' && s !== null) {
        s.weather = 'clear';
        s.forecast = ['clear', 'clear'];
        s.events = [];
        s.nextEventId = 1;
        s.eventCooldown = 60;
        s.priceFactors = {};
        s.supplierDiscount = null;
    }
    obj.schema_version = 6;
    return obj;
}

/** v6 -> v7:没有进行中的市场影响。 */
function migrateV6toV7(obj: any): any {
    const s = obj.state;
    if (typeof s === 'object' && s !== null) s.market = { traffic: null, supplyCost: null, salePrice: null };
    obj.schema_version = 7;
    return obj;
}

/** v7 -> v8:已有的顾客都是普通客人;没有反馈记录。 */
function migrateV7toV8(obj: any): any {
    const s = obj.state;
    if (typeof s === 'object' && s !== null) {
        if (Array.isArray(s.customers)) {
            for (const c of s.customers) {
                if (c && typeof c === 'object') {
                    c.kind = 'normal';
                    c.missedItems = [];
                }
            }
        }
        s.feedback = [];
        s.nextFeedbackId = 1;
    }
    obj.schema_version = 8;
    return obj;
}

/** v8 -> v9:没有商户和员工,广告次数从今天算起。 */
function migrateV8toV9(obj: any): any {
    const s = obj.state;
    if (typeof s === 'object' && s !== null) {
        s.merchants = [];
        s.staff = [];
        s.nextStaffId = 1;
        s.ads = { day: isInt(s.day) ? s.day : 1, used: {} };
        s.distressDays = 0;
        s.incidentsToday = 0;
    }
    obj.schema_version = 9;
    return obj;
}

// ---------------------------------------------------------------- 校验

const EVENT_TYPE_LIST: ReadonlyArray<string> = EVENT_TYPES;

function parseEvent(e: any): ActiveEvent | null {
    if (typeof e !== 'object' || e === null || !isInt(e.id) || e.id < 1 || EVENT_TYPE_LIST.indexOf(e.type) < 0) return null;
    if (e.itemId !== null && !isStr(e.itemId)) return null;
    if (!isNum(e.remainingSec) || !isNum(e.totalSec) || e.totalSec <= 0) return null;
    return { id: e.id, type: e.type, itemId: e.itemId, remainingSec: e.remainingSec, totalSec: e.totalSec };
}

function parsePriceFactor(f: any): PriceFactor | null {
    if (typeof f !== 'object' || f === null || !isNum(f.factor) || f.factor <= 0 || !isInt(f.untilDay)) return null;
    return { factor: f.factor, untilDay: f.untilDay };
}

const FIXTURE_KINDS: FixtureKind[] = ['shelf', 'fridge', 'glass', 'counter', 'computer', 'decor'];

function parseFixture(f: any): Fixture | null {
    if (typeof f !== 'object' || f === null || !isStr(f.id)) return null;
    if (FIXTURE_KINDS.indexOf(f.kind) < 0) return null;
    if (!isNum(f.x) || !isNum(f.z) || !isNum(f.w) || f.w <= 0 || !isNum(f.d) || f.d <= 0 || !isNum(f.height) || f.height <= 0) return null;
    const front = f.front;
    if (typeof front !== 'object' || front === null || !FRONTS.some((v) => v.x === front.x && v.z === front.z)) return null;
    if (f.capacity !== undefined && (!isInt(f.capacity) || f.capacity < 1)) return null;
    if (f.equipId !== undefined && !isStr(f.equipId)) return null;
    if (f.movable !== undefined && typeof f.movable !== 'boolean') return null;
    if (f.collides !== undefined && typeof f.collides !== 'boolean') return null;
    const out: Fixture = { id: f.id, kind: f.kind, x: f.x, z: f.z, w: f.w, d: f.d, height: f.height, front: { x: front.x, z: front.z } };
    if (f.capacity !== undefined) out.capacity = f.capacity;
    if (f.equipId !== undefined) out.equipId = f.equipId;
    if (f.movable !== undefined) out.movable = f.movable;
    if (f.collides !== undefined) out.collides = f.collides;
    return out;
}

function parseTrash(t: any): TrashPiece | null {
    if (typeof t !== 'object' || t === null || !isInt(t.id) || t.id < 1 || !isNum(t.x) || !isNum(t.z)) return null;
    return { id: t.id, x: t.x, z: t.z };
}

function parseOrder(o: any): Order | null {
    if (typeof o !== 'object' || o === null) return null;
    if (!isInt(o.id) || o.id < 1 || !isStr(o.itemId)) return null;
    if (!isInt(o.quantity) || o.quantity < 1 || !isInt(o.cost) || o.cost < 0) return null;
    if (o.status !== 'delivering' && o.status !== 'arrived') return null;
    if (!isNum(o.placedAtMinute) || !isNum(o.arriveAtMinute)) return null;
    return {
        id: o.id,
        itemId: o.itemId,
        quantity: o.quantity,
        cost: o.cost,
        status: o.status,
        placedAtMinute: o.placedAtMinute,
        arriveAtMinute: o.arriveAtMinute,
    };
}

function parseCarton(c: any): Carton | null {
    if (typeof c !== 'object' || c === null) return null;
    if (!isInt(c.id) || c.id < 1 || !isStr(c.itemId)) return null;
    if (c.orderId !== null && !isInt(c.orderId)) return null;
    if (!isInt(c.units) || c.units < 1) return null;
    if (c.location !== 'door' && c.location !== 'hands') return null;
    if (!isInt(c.xpLeft) || c.xpLeft < 0 || c.xpLeft > c.units) return null;
    return { id: c.id, orderId: c.orderId, itemId: c.itemId, units: c.units, location: c.location, xpLeft: c.xpLeft };
}

/** 校验 { 键: 正整数 } 形式的字典(允许为空)。 */
function parseCountMap(m: any): { [key: string]: number } | null {
    if (typeof m !== 'object' || m === null || Array.isArray(m)) return null;
    const out: { [key: string]: number } = {};
    for (const k of Object.keys(m)) {
        if (!isInt(m[k]) || m[k] < 1) return null;
        out[k] = m[k];
    }
    return out;
}

function parseWant(w: any): WantLine | null {
    if (typeof w !== 'object' || w === null || !isStr(w.itemId) || !isInt(w.units) || w.units < 1) return null;
    return { itemId: w.itemId, units: w.units };
}

function parseCartLine(w: any): CartLine | null {
    if (typeof w !== 'object' || w === null || !isStr(w.itemId) || !isStr(w.fixtureId) || !isInt(w.units) || w.units < 1) return null;
    return { itemId: w.itemId, units: w.units, fixtureId: w.fixtureId };
}

function parseList<T>(list: any, parse: (x: any) => T | null): T[] | null {
    if (!Array.isArray(list)) return null;
    const out: T[] = [];
    for (const x of list) {
        const v = parse(x);
        if (v === null) return null;
        out.push(v);
    }
    return out;
}

const CUSTOMER_KINDS: CustomerKind[] = ['normal', 'survey', 'secret'];

function parseFeedback(f: any): FeedbackRecord | null {
    if (typeof f !== 'object' || f === null || !isInt(f.id) || f.id < 1 || !isInt(f.day) || f.day < 1) return null;
    if (f.kind !== 'survey' && f.kind !== 'secret') return null;
    if (!isInt(f.rating) || f.rating < 1 || f.rating > 5) return null;
    if (!isInt(f.find) || f.find < 0 || f.find > 2 || !isInt(f.wait) || f.wait < 0 || f.wait > 2) return null;
    if (f.wishItemId !== null && !isStr(f.wishItemId)) return null;
    if (!Array.isArray(f.reasons) || !f.reasons.every(isStr) || typeof f.paid !== 'boolean') return null;
    return { id: f.id, day: f.day, kind: f.kind, rating: f.rating, find: f.find, wait: f.wait, wishItemId: f.wishItemId, reasons: f.reasons.slice(), paid: f.paid };
}

const STAFF_ROLES: StaffRole[] = ['cashier', 'stocker'];

function parseLease(l: any): MerchantLease | null {
    if (typeof l !== 'object' || l === null || !isInt(l.slot) || l.slot < 0 || !isStr(l.merchantId)) return null;
    if (!isInt(l.signedDay) || !isInt(l.expiresDay) || !isInt(l.badDays) || l.badDays < 0) return null;
    return { slot: l.slot, merchantId: l.merchantId, signedDay: l.signedDay, expiresDay: l.expiresDay, badDays: l.badDays };
}

function parseStaff(m: any): StaffMember | null {
    if (typeof m !== 'object' || m === null || !isInt(m.id) || m.id < 1 || STAFF_ROLES.indexOf(m.role) < 0 || !isInt(m.hiredDay)) return null;
    return { id: m.id, role: m.role, hiredDay: m.hiredDay };
}

function parseCustomer(c: any): Customer | null {
    if (typeof c !== 'object' || c === null) return null;
    if (!isInt(c.id) || c.id < 1 || (c.phase !== 'browsing' && c.phase !== 'queuing')) return null;
    if (!isNum(c.timer) || !isNum(c.waited) || c.waited < 0 || typeof c.scanned !== 'boolean') return null;
    if (!isInt(c.joinSeq) || c.joinSeq < 0) return null;
    if (CUSTOMER_KINDS.indexOf(c.kind) < 0) return null;
    if (!Array.isArray(c.missedItems) || !c.missedItems.every(isStr)) return null;
    const wants = parseList(c.wants, parseWant);
    const cart = parseList(c.cart, parseCartLine);
    if (!wants || !cart) return null;
    return { id: c.id, kind: c.kind, missedItems: c.missedItems.slice(), phase: c.phase, timer: c.timer, waited: c.waited, wants, cart, scanned: c.scanned, joinSeq: c.joinSeq };
}

function parseStats(t: any): DayStats | null {
    if (typeof t !== 'object' || t === null) return null;
    if (!isInt(t.day) || t.day < 1 || !isInt(t.revenue) || t.revenue < 0) return null;
    if (!isInt(t.served) || t.served < 0 || !isInt(t.lost) || t.lost < 0 || !isNum(t.satisfactionStart)) return null;
    const sold = parseCountMap(t.sold);
    const missed = parseCountMap(t.missed);
    if (!sold || !missed) return null;
    return { day: t.day, revenue: t.revenue, served: t.served, lost: t.lost, sold, missed, satisfactionStart: t.satisfactionStart };
}

function parseReport(r: any): DayReport | null {
    if (typeof r !== 'object' || r === null) return null;
    const ints = [r.day, r.revenue, r.served, r.lost, r.soldUnits];
    for (const v of ints) if (!isInt(v) || v < 0) return null;
    if (r.bestSeller !== null && !isStr(r.bestSeller)) return null;
    if (!Array.isArray(r.missed) || !r.missed.every(isStr)) return null;
    if (!isNum(r.satisfactionStart) || !isNum(r.satisfactionEnd)) return null;
    return {
        day: r.day,
        revenue: r.revenue,
        served: r.served,
        lost: r.lost,
        soldUnits: r.soldUnits,
        bestSeller: r.bestSeller,
        missed: r.missed.slice(),
        satisfactionStart: r.satisfactionStart,
        satisfactionEnd: r.satisfactionEnd,
    };
}

function parseTutorial(t: any): TutorialState | null {
    if (typeof t !== 'object' || t === null) return null;
    if (!isInt(t.step) || t.step < 0 || t.step > TUTORIAL_STEP_COUNT || typeof t.moved !== 'boolean') return null;
    return { step: t.step, moved: t.moved };
}

/** 解析并校验存档文本。校验失败返回 corrupt,绝不抛异常。 */
export function parseSave(raw: string | null | undefined): LoadResult {
    // 空字符串与 null 都表示"没有存档"(部分平台的存储对不存在的 key 返回空字符串)
    if (raw === null || raw === undefined || raw === '') return { kind: 'empty' };

    let obj: any;
    try {
        obj = JSON.parse(raw);
    } catch {
        return { kind: 'corrupt', reason: '不是合法的 JSON' };
    }
    if (typeof obj !== 'object' || obj === null) return { kind: 'corrupt', reason: '存档不是对象' };

    const version = obj.schema_version;
    if (!isInt(version) || version < 1) return { kind: 'corrupt', reason: 'schema_version 缺失或无效' };
    if (version > SAVE_SCHEMA_VERSION) return { kind: 'tooNew', version };
    if (version <= 1) obj = migrateV1toV2(obj);
    if (version <= 2) obj = migrateV2toV3(obj);
    if (version <= 3) obj = migrateV3toV4(obj);
    if (version <= 4) obj = migrateV4toV5(obj);
    if (version <= 5) obj = migrateV5toV6(obj);
    if (version <= 6) obj = migrateV6toV7(obj);
    if (version <= 7) obj = migrateV7toV8(obj);
    if (version <= 8) obj = migrateV8toV9(obj);

    const s = obj.state;
    const bad = (reason: string): LoadResult => ({ kind: 'corrupt', reason });
    if (typeof s !== 'object' || s === null) return bad('缺少 state');
    if (!isInt(s.coins)) return bad('coins 无效');
    if (!isNum(s.satisfaction)) return bad('satisfaction 无效');
    if (!isInt(s.level) || s.level < 1) return bad('level 无效');
    if (!isInt(s.xp) || s.xp < 0) return bad('xp 无效');
    if (!isInt(s.day) || s.day < 1) return bad('day 无效');
    if (!isNum(s.timeOfDay) || s.timeOfDay < 0 || s.timeOfDay >= 1) return bad('timeOfDay 无效');
    if (typeof s.isOpen !== 'boolean') return bad('isOpen 无效');

    const orders = parseList(s.orders, parseOrder);
    if (!orders) return bad('orders 无效');
    if (!isInt(s.nextOrderId) || s.nextOrderId < 1) return bad('nextOrderId 无效');

    const cartons = parseList(s.cartons, parseCarton);
    if (!cartons) return bad('cartons 无效');
    if (!isInt(s.nextCartonId) || s.nextCartonId < 1) return bad('nextCartonId 无效');
    if (cartons.filter((c) => c.location === 'hands').length > 1) return bad('手里不能同时抱着多个纸箱');

    if (typeof s.stock !== 'object' || s.stock === null || Array.isArray(s.stock)) return bad('stock 无效');
    const stock: { [fixtureId: string]: { [itemId: string]: number } } = {};
    for (const fixtureId of Object.keys(s.stock)) {
        const contents = parseCountMap(s.stock[fixtureId]);
        if (!contents) return bad(`stock.${fixtureId} 无效`);
        if (Object.keys(contents).length > 0) stock[fixtureId] = contents;
    }
    const warehouse = parseCountMap(s.warehouse);
    if (!warehouse) return bad('warehouse 无效');

    const customers = parseList(s.customers, parseCustomer);
    if (!customers) return bad('customers 无效');
    if (!isInt(s.nextCustomerId) || s.nextCustomerId < 1) return bad('nextCustomerId 无效');
    if (!isInt(s.nextQueueSeq) || s.nextQueueSeq < 1) return bad('nextQueueSeq 无效');
    if (!isNum(s.spawnProgress) || s.spawnProgress < 0) return bad('spawnProgress 无效');
    if (!isInt(s.rngState)) return bad('rngState 无效');
    if (!isInt(s.totalServed) || s.totalServed < 0) return bad('totalServed 无效');

    const today = parseStats(s.today);
    if (!today) return bad('today 无效');
    let pendingReport: DayReport | null = null;
    if (s.pendingReport !== null) {
        pendingReport = parseReport(s.pendingReport);
        if (!pendingReport) return bad('pendingReport 无效');
    }
    const tutorial = parseTutorial(s.tutorial);
    if (!tutorial) return bad('tutorial 无效');

    const fixtures = parseList(s.fixtures, parseFixture);
    if (!fixtures) return bad('fixtures 无效');
    if (!fixtures.some((f) => f.kind === 'counter') || !fixtures.some((f) => f.kind === 'computer')) return bad('缺少收银台或电脑桌');
    if (new Set(fixtures.map((f) => f.id)).size !== fixtures.length) return bad('fixtures 的 id 有重复');
    if (!isInt(s.nextFixtureId) || s.nextFixtureId < 1) return bad('nextFixtureId 无效');
    if (!isInt(s.expansion) || s.expansion < 0 || s.expansion >= EXPANSION_SIZES.length) return bad('expansion 无效');
    if (!Array.isArray(s.unlockedThemes) || !s.unlockedThemes.every(isStr)) return bad('unlockedThemes 无效');
    if (!isStr(s.theme)) return bad('theme 无效');
    const trash = parseList(s.trash, parseTrash);
    if (!trash) return bad('trash 无效');
    if (!isInt(s.nextTrashId) || s.nextTrashId < 1) return bad('nextTrashId 无效');

    if (!isWeatherKind(s.weather)) return bad('weather 无效');
    if (!Array.isArray(s.forecast) || s.forecast.length !== 2 || !s.forecast.every(isWeatherKind)) return bad('forecast 无效');
    const activeEvents = parseList(s.events, parseEvent);
    if (!activeEvents) return bad('events 无效');
    if (!isInt(s.nextEventId) || s.nextEventId < 1) return bad('nextEventId 无效');
    if (!isNum(s.eventCooldown)) return bad('eventCooldown 无效');
    if (typeof s.priceFactors !== 'object' || s.priceFactors === null || Array.isArray(s.priceFactors)) return bad('priceFactors 无效');
    const priceFactors: { [itemId: string]: PriceFactor } = {};
    for (const id of Object.keys(s.priceFactors)) {
        const f = parsePriceFactor(s.priceFactors[id]);
        if (!f) return bad(`priceFactors.${id} 无效`);
        priceFactors[id] = f;
    }
    let supplierDiscount: PriceFactor | null = null;
    if (s.supplierDiscount !== null) {
        supplierDiscount = parsePriceFactor(s.supplierDiscount);
        if (!supplierDiscount) return bad('supplierDiscount 无效');
    }
    if (typeof s.market !== 'object' || s.market === null) return bad('market 无效');
    const market: MarketState = { traffic: null, supplyCost: null, salePrice: null };
    for (const slot of ['traffic', 'supplyCost', 'salePrice'] as const) {
        if (s.market[slot] === null) continue;
        const f = parsePriceFactor(s.market[slot]);
        if (!f) return bad(`market.${slot} 无效`);
        market[slot] = f;
    }

    const feedback = parseList(s.feedback, parseFeedback);
    if (!feedback) return bad('feedback 无效');
    if (!isInt(s.nextFeedbackId) || s.nextFeedbackId < 1) return bad('nextFeedbackId 无效');

    const merchants = parseList(s.merchants, parseLease);
    if (!merchants) return bad('merchants 无效');
    if (new Set(merchants.map((m) => m.slot)).size !== merchants.length) return bad('merchants 的档口有重复');
    const staff = parseList(s.staff, parseStaff);
    if (!staff) return bad('staff 无效');
    if (!isInt(s.nextStaffId) || s.nextStaffId < 1) return bad('nextStaffId 无效');
    if (typeof s.ads !== 'object' || s.ads === null || !isInt(s.ads.day) || typeof s.ads.used !== 'object' || s.ads.used === null || Array.isArray(s.ads.used)) return bad('ads 无效');
    const adsUsed: { [placement: string]: number } = {};
    for (const k of Object.keys(s.ads.used)) {
        if (!isInt(s.ads.used[k]) || s.ads.used[k] < 0) return bad(`ads.used.${k} 无效`);
        adsUsed[k] = s.ads.used[k];
    }
    const ads: AdUsage = { day: s.ads.day, used: adsUsed };
    if (!isInt(s.distressDays) || s.distressDays < 0) return bad('distressDays 无效');
    if (!isInt(s.incidentsToday) || s.incidentsToday < 0) return bad('incidentsToday 无效');

    // 主题:只保留还存在的主题,默认主题永远已解锁;当前主题不在已解锁里就回到默认
    const known = THEMES.map((t) => t.id);
    const unlockedThemes = [DEFAULT_THEME_ID, ...(s.unlockedThemes as string[]).filter((id) => id !== DEFAULT_THEME_ID && known.indexOf(id) >= 0)];
    const theme = unlockedThemes.indexOf(s.theme) >= 0 ? s.theme : DEFAULT_THEME_ID;
    // 设施编号形如 "shelf_n12",取其中最大的序号,保证新生成的 id 不会重复
    const fixtureSeq = fixtures.map((f) => {
        const m = /_n(\d+)$/.exec(f.id);
        return m ? Number(m[1]) : 0;
    });

    // 编号归一化:保证新生成的编号不会与已有的重复
    const maxOf = (nums: number[]) => nums.reduce((m, n) => (n > m ? n : m), 0);

    return {
        kind: 'ok',
        state: {
            coins: s.coins,
            satisfaction: Math.min(100, Math.max(0, s.satisfaction)),
            level: s.level,
            xp: s.xp,
            day: s.day,
            timeOfDay: s.timeOfDay,
            isOpen: s.isOpen,
            orders,
            nextOrderId: Math.max(s.nextOrderId, maxOf(orders.map((o) => o.id)) + 1),
            cartons,
            nextCartonId: Math.max(s.nextCartonId, maxOf(cartons.map((c) => c.id)) + 1),
            stock,
            warehouse,
            customers,
            nextCustomerId: Math.max(s.nextCustomerId, maxOf(customers.map((c) => c.id)) + 1),
            nextQueueSeq: Math.max(s.nextQueueSeq, maxOf(customers.map((c) => c.joinSeq)) + 1),
            spawnProgress: s.spawnProgress,
            rngState: s.rngState,
            totalServed: s.totalServed,
            today,
            pendingReport,
            tutorial,
            fixtures,
            nextFixtureId: Math.max(s.nextFixtureId, maxOf(fixtureSeq) + 1),
            expansion: s.expansion,
            theme,
            unlockedThemes,
            trash,
            nextTrashId: Math.max(s.nextTrashId, maxOf(trash.map((t) => t.id)) + 1),
            weather: s.weather,
            forecast: s.forecast.slice(),
            events: activeEvents,
            nextEventId: Math.max(s.nextEventId, maxOf(activeEvents.map((e) => e.id)) + 1),
            eventCooldown: s.eventCooldown,
            priceFactors,
            supplierDiscount,
            market,
            feedback,
            nextFeedbackId: Math.max(s.nextFeedbackId, maxOf(feedback.map((f) => f.id)) + 1),
            merchants,
            staff,
            nextStaffId: Math.max(s.nextStaffId, maxOf(staff.map((m) => m.id)) + 1),
            ads,
            distressDays: s.distressDays,
            incidentsToday: s.incidentsToday,
        },
    };
}

export class SaveManager {
    /** 读到更新版本的存档时置为 true,此后不再写入,避免把玩家的新版存档覆盖掉。 */
    private writeLocked = false;

    constructor(
        private readonly storage: KeyValueStorage,
        private readonly key = 'shop-manager.save',
    ) {}

    load(): LoadResult {
        const raw = this.storage.getItem(this.key);
        const result = parseSave(raw);
        if (result.kind === 'corrupt' && raw !== null) {
            // 保留一份损坏的原文以便排查,然后清掉主存档,允许重新开局
            this.storage.setItem(`${this.key}.corrupt`, raw);
            this.storage.removeItem(this.key);
        } else if (result.kind === 'tooNew') {
            this.writeLocked = true;
        }
        return result;
    }

    /** 保存。返回是否真的写入了。 */
    save(state: GameState): boolean {
        if (this.writeLocked) return false;
        try {
            this.storage.setItem(this.key, serializeState(state));
            return true;
        } catch {
            return false; // 存储空间不足等:不能因为存档失败让游戏崩溃
        }
    }
}
